
// src/api.js

/**
 * Llama a la API de Gemini para generar contenido.
 * @param {string} prompt - El prompt para el modelo de IA.
 * @param {boolean} isStructured - Si se espera una respuesta JSON estructurada.
 * @param {object} schema - El esquema para la respuesta JSON.
 * @returns {Promise<string|object|null>} - El contenido generado.
 */
export const callGeminiAPI = async (prompt, isStructured = false, schema = {}, customApiKey = null) => {
    try {
        let chatHistory = [{ role: "user", parts: [{ text: prompt }] }];
        const payload = { contents: chatHistory };

        let apiKey = customApiKey;
        if (!apiKey) {
            if (typeof process !== 'undefined' && process.env && process.env.GEMINI_API_KEY) {
                apiKey = process.env.GEMINI_API_KEY;
            } else if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_GEMINI_API_KEY) {
                apiKey = import.meta.env.VITE_GEMINI_API_KEY;
            }
        }
        if (!apiKey) throw new Error("Gemini API Key not configured. Please set GEMINI_API_KEY environment variable.");

        if (isStructured) {
            payload.generationConfig = {
                responseMimeType: "application/json",
                responseSchema: schema
            };
        }

        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(`Error de API de Gemini: ${response.status} - ${errorData.error.message || 'Error desconocido'}`);
        }

        const result = await response.json();

        if (result.candidates?.[0]?.content?.parts?.[0]?.text) {
            const text = result.candidates[0].content.parts[0].text;
            return isStructured ? JSON.parse(text) : text;
        } else {
            throw new Error("Respuesta inesperada de la API de Gemini.");
        }
    } catch (err) {
        console.error("Error al llamar a la API de Gemini:", err);
        // Re-lanzamos el error para que el componente que llama pueda manejarlo.
        throw err;
    }
};

/**
 * Obtiene las tendencias de un subreddit a través del backend worker.
 * @param {string} subreddit - El nombre del subreddit.
 * @returns {Promise<Array>} - Una lista de posts populares.
 */
export const fetchRedditTrends = async (subreddit) => {
    try {
        const response = await fetch('https://reddit-api-worker.growmybisznow.workers.dev/fetch-trends', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ subreddit, clientSecret: process.env.REDDIT_CLIENT_SECRET })
        });

        if (!response.ok) {
            // Verificar si la respuesta es JSON antes de intentar parsearla
            const contentType = response.headers.get('content-type');
            let errorMessage = `Fallo al obtener tendencias de Reddit: ${response.status} ${response.statusText}`;

            if (contentType && contentType.includes('application/json')) {
                const errorData = await response.json();
                errorMessage += ` - ${errorData.message || JSON.stringify(errorData)}`;
            } else {
                const errorText = await response.text();
                errorMessage += ` - ${errorText}`;
            }
            throw new Error(errorMessage);
        }

        return await response.json();
    } catch (err) {
        console.error("Error en fetchRedditTrends:", err);
        throw err;
    }
};

/**
 * Publica un artículo en Reddit a través del backend worker.
 * @param {object} articleData - Los datos del artículo { title, flair, content, subreddit }.
 * @returns {Promise<object>} - La respuesta del backend.
 */
export const publishToReddit = async (articleData) => {
    try {
        const response = await fetch('https://reddit-api-worker.growmybisznow.workers.dev/publish-reddit', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ ...articleData, clientSecret: process.env.REDDIT_CLIENT_SECRET })
        });

        if (!response.ok) {
            // Verificar si la respuesta es JSON antes de intentar parsearla
            const contentType = response.headers.get('content-type');
            let errorMessage = `Fallo al publicar en Reddit: ${response.status} ${response.statusText}`;

            if (contentType && contentType.includes('application/json')) {
                const errorData = await response.json();
                errorMessage += ` - ${errorData.message || JSON.stringify(errorData)}`;
            } else {
                const errorText = await response.text();
                errorMessage += ` - ${errorText}`;
            }
            throw new Error(errorMessage);
        }

        return await response.json();
    } catch (err) {
        console.error("Error en publishToReddit:", err);
        throw err;
    }
};
