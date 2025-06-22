// api/connections.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import fetch from 'node-fetch'; // Required if 'fetch' is not globally available in your Node.js runtime, safer to include.

// --- Type Definitions (Highly Recommended for TypeScript) ---
interface SupabaseDataItem {
  id: number;
  name: string;
  university: string;
  tags: string[]; // Assuming 'tags' column in Supabase is an array of strings
  linkedin: string;
}

interface GeminiContentPart {
  text: string;
}

interface GeminiCandidate {
  content: {
    parts: GeminiContentPart[];
  };
}

interface GeminiResponse {
  candidates?: GeminiCandidate[];
  // You might also find other fields like 'promptFeedback' or 'safetyRatings'
  // depending on the Gemini API response structure and your needs.
}

// --- Main Serverless Function Handler ---
export default async function handler(req: VercelRequest, res: VercelResponse) {

  // Set the necessary CORS headers for ALL responses (including preflight and errors)
  // IMPORTANT: Replace 'https://my-university-amber.vercel.app' with your actual frontend URL
  res.setHeader('Access-Control-Allow-Origin', 'https://my-university-amber.vercel.app');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS'); // Allow POST and OPTIONS methods
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type'); // Allow Content-Type header
  res.setHeader('Access-Control-Allow-Credentials', 'true'); // If your frontend sends cookies/auth headers
  res.setHeader('Access-Control-Max-Age', '86400'); // Cache preflight response for 24 hours

  // --- Handle Preflight OPTIONS Request ---
  // Browsers send an OPTIONS request before the actual POST request for CORS
  if (req.method === 'OPTIONS') {
    // Respond with 200 OK for preflight. Headers are already set above.
    return res.status(200).send();
  }

  // --- Handle Actual POST Request ---
  if (req.method !== 'POST') {
    // If it's not OPTIONS and not POST, it's an unsupported method
    return res.status(405).json({ error: 'Method Not Allowed. This endpoint only supports POST requests.' });
  }

  // Extract the userPrompt from the request body
  const { userPrompt } = req.body;

  // Basic validation for the userPrompt
  if (!userPrompt || typeof userPrompt !== 'string' || userPrompt.trim() === '') {
    return res.status(400).json({ error: "A valid 'userPrompt' is required in the request body." });
  }

  // --- Securely Access API Keys from Vercel Environment Variables ---
  // These variables MUST be configured in your Vercel project settings for this backend repo!
  const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_KEY;
  const SUPABASE_TABLE_NAME = "userData"; // Make sure this matches your Supabase table name

  // Critical check: Ensure environment variables are loaded
  if (!GOOGLE_API_KEY || !SUPABASE_URL || !SUPABASE_KEY) {
    console.error("Missing one or more environment variables!");
    // Send a generic error to the client, but log details to Vercel logs
    return res.status(500).json({
      error: "Server configuration error: API keys not loaded. Please check Vercel environment variables.",
      // In development, you might expose more details, but remove for production
      details: process.env.NODE_ENV === 'development' ? 'Check GOOGLE_API_KEY, SUPABASE_URL, SUPABASE_KEY' : undefined
    });
  }

  try {
    // --- 1. Fetch data from Supabase ---
    // Construct the Supabase URL to select specific columns
    const supabaseFetchUrl = `${SUPABASE_URL}/rest/v1/${SUPABASE_TABLE_NAME}?select=id,name,university,tags,linkedin`;

    const supabaseResponse = await fetch(supabaseFetchUrl, {
      method: 'GET', // Supabase read operations are typically GET
      headers: {
        'apikey': SUPABASE_KEY, // Use the Supabase 'anon' (public) key here
        'Content-Type': 'application/json'
      }
    });

    // Check if the Supabase response was successful (status 2xx)
    if (!supabaseResponse.ok) {
      const errorData = await supabaseResponse.json();
      console.error("Supabase fetch failed:", errorData); // Log detailed error for debugging
      throw new Error(`Supabase fetch failed: ${errorData.message || 'Unknown error'}`);
    }
    // Parse the JSON response from Supabase
    const supabaseData: SupabaseDataItem[] = await supabaseResponse.json();
    console.log("Data fetched from Supabase:", supabaseData); // For debugging in Vercel logs

    // Format the Supabase data into a string to include in the Gemini prompt
    let formattedSupabaseData = "Available users data:\n";
    if (supabaseData.length > 0) {
      supabaseData.forEach(item => {
        // Ensure 'tags' is handled as an array, converting to comma-separated string
        // --- MODIFIED: Removed square brackets from around tagsString ---
        const tagsString = Array.isArray(item.tags) ? item.tags.join(', ') : ''; // Added space after comma for readability
        formattedSupabaseData += `- ID: ${item.id}, Name: "${item.name}", University: "${item.university}", Tags: ${tagsString}, LinkedIn: "${item.linkedin}"\n`;
      });
    } else {
      formattedSupabaseData += "No users found in the database.\n";
    }

    // --- 2. Prepare and send data to Gemini AI ---
    const geminiApiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GOOGLE_API_KEY}`;

    // Construct the full prompt for Gemini, combining Supabase data and user query
    // --- MODIFIED: Added emphasis on 'tags/interests' in the prompt ---
    const fullPrompt = `${formattedSupabaseData}\n\nUser query: "${userPrompt}"\n\nBased on the available users and my query, identify any users whose name, university, or **tags/interests** match the user's intent or provide relevant information. For each matched user, output their details in this exact format: "Name: [Name]|University: [University Name]|Interests: [Comma separated tags]|LinkedIn: [LinkedIn URL]". If no match is found, just say "No matches found."`;

    // Construct the request body for the Gemini API
    const requestBody = {
      contents: [
        {
          parts: [
            { text: fullPrompt }
          ]
        }
      ]
    };

    // Send the POST request to the Gemini API
    const geminiResponse = await fetch(geminiApiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody) // Convert the JS object to a JSON string
    });

    // Check if the Gemini response was successful
    if (!geminiResponse.ok) {
        const errorData = await geminiResponse.json();
        console.error("Gemini AI API failed:", errorData); // Log detailed error for debugging
        throw new Error(`Gemini API call failed: ${errorData.error?.message || 'Unknown error'}`);
    }

    // Parse the JSON response from Gemini
    const geminiResult: GeminiResponse = await geminiResponse.json();
    console.log("Raw Gemini AI Response:", geminiResult); // For debugging in Vercel logs

    // --- 3. Send the Gemini result back to the frontend ---
    // The frontend expects this JSON response. CORS headers are already set above.
    return res.status(200).json(geminiResult);

  } catch (error: any) {
    // Catch any errors that occurred during the process (Supabase, Gemini, etc.)
    console.error("Serverless function encountered an error:", error);
    // Send a generic 500 Internal Server Error message to the client.
    // CORS headers are already set.
    return res.status(500).json({
        error: "An internal server error occurred while processing your request.",
        // Only expose specific error details in development mode for security
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
}
