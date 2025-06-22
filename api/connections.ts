import type { VercelRequest, VercelResponse } from '@vercel/node';
import fetch from 'node-fetch';

interface SupabaseDataItem {
    id: number;
    name: string;
    university: string;
    tags: string[];
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
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const { userPrompt } = req.body;

    if (!userPrompt || typeof userPrompt !== 'string' || userPrompt.trim() === '') {
        return res.status(400).json({ error: "A valid 'userPrompt' is required in the request body." });
    }

    const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_KEY = process.env.SUPABASE_KEY;
    const SUPABASE_TABLE_NAME = "userData";

    if (!GOOGLE_API_KEY || !SUPABASE_URL || !SUPABASE_KEY) {
        console.error("Missing environment variables!");
        return res.status(500).json({ error: "Server configuration error: API keys not loaded." });
    }

    try {
        const supabaseFetchUrl = `<span class="math-inline">\{SUPABASE\_URL\}/rest/v1/</span>{SUPABASE_TABLE_NAME}?select=id,name,university,tags,linkedin`;
        const supabaseResponse = await fetch(supabaseFetchUrl, {
            method: 'GET',
            headers: {
                'apikey': SUPABASE_KEY,
                'Content-Type': 'application/json'
            }
        });

        if (!supabaseResponse.ok) {
            const errorData = await supabaseResponse.json();
            console.error("Supabase fetch error:", errorData);
            throw new Error(`Supabase fetch failed: ${errorData.message || 'Unknown error'}`);
        }
        const supabaseData: SupabaseDataItem[] = await supabaseResponse.json();

        let formattedSupabaseData = "Available users data:\n";
        if (supabaseData.length > 0) {
            supabaseData.forEach(item => {
                const tagsString = Array.isArray(item.tags) ? item.tags.join(',') : '';
                formattedSupabaseData += `- ID: <span class="math-inline">\{item\.id\}, Name\: "</span>{item.name}", University: "<span class="math-inline">\{item\.university\}", Tags\: \[</span>{tagsString}], LinkedIn: "${item.linkedin}"\n`;
            });
        } else {
            formattedSupabaseData += "No users found in the database.\n";
        }

        const geminiApiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GOOGLE_API_KEY}`;
        const fullPrompt = `<span class="math-inline">\{formattedSupabaseData\}\\n\\nUser query\: "</span>{userPrompt}"\n\nBased on the available users and my query, identify any users that match my intent or provide relevant information. For each matched user, output their details in this exact format: "Name: [Name]|University: [University Name]|Interests: [Comma separated tags]|LinkedIn: [LinkedIn URL]". If no match is found, just say "No matches found."`;

        const requestBody = {
            contents: [
                {
                    parts: [
                        { text: fullPrompt }
                    ]
                }
            ]
        };

        const geminiResponse = await fetch(geminiApiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
        });

        if (!geminiResponse.ok) {
            const errorData = await geminiResponse.json();
            console.error("Gemini AI API error:", errorData);
            throw new Error(`Gemini API call failed: ${errorData.error?.message || 'Unknown error'}`);
        }

        const geminiResult: GeminiResponse = await geminiResponse.json();
        return res.status(200).json(geminiResult);

    } catch (error: any) {
        console.error("Serverless function error:", error);
        return res.status(500).json({
            error: "An internal server error occurred.",
            details: error.message || "Unknown error"
        });
    }
}
