import React, { useState, useEffect, useCallback } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, addDoc, query, orderBy, onSnapshot, doc, updateDoc, getDocs } from 'firebase/firestore';
import { callGeminiAPI, fetchRedditTrends as fetchTrends, publishToReddit } from './api';

// Global variables provided by el entorno Canvas.
// Cuando se ejecuta localmente o se despliega fuera de Canvas, estas serán undefined.
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';

// IMPORTANTE: Para desplegar en GitHub Pages, DEBES reemplazar esto con la configuración REAL de tu proyecto Firebase.
// Obtén esto de la configuración de tu proyecto Firebase -> Configuración del proyecto -> General -> Tus apps -> Fragmento de SDK de Firebase -> Config
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {
    // **************************************************************************
    // *** PEGA AQUÍ LA CONFIGURACIÓN REAL DE TU PROYECTO FIREBASE ***
    // **************************************************************************
    apiKey: "AIzaSyBhOPKsR8ZCnjSQAOpbKGJyflOyfEoQk9Q",
    authDomain: "reddit-content-assistant.firebaseapp.com",
    projectId: "reddit-content-assistant",
    storageBucket: "reddit-content-assistant.firebasestorage.app",
    messagingSenderId: "481199590667",
    appId: "1:481199590667:web:fd2310fa11b81f0153e60e",
    measurementId: "G-JFDRFHS9KL"
};

const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

// Función de utilidad para copiar texto al portapapeles
const copyToClipboard = (text) => {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    try {
        document.execCommand('copy');
        // Reemplaza alert con un modal personalizado para producción
        alert('¡Contenido copiado al portapapeles!');
    } catch (err) {
        console.error('Error al copiar al portapapeles: ', err);
        // Reemplaza alert con un modal personalizado para producción
        alert('Error al copiar el contenido al portapapeles.');
    }
    document.body.removeChild(textarea);
};

// Función de utilidad para limpiar el contenido del artículo antes de copiar
const cleanArticleContent = (rawContent) => {
    const lines = rawContent.split('\n');
    const cleanedLines = [];

    const instructionalPatterns = [
        /^\s*---\s*$/, // Separadores de Markdown
        /^Hey, fellow entrepreneurs!/, // Línea de introducción específica
        /^\*\*The Challenge:\*\* \[Generate content here that contextualizes the common situation small businesses face\.\]$/, // Marcador de posición instruccional para el desafío
        /^\*\*\[Generate a compelling subtitle for the Solution\/Guía - IN BOLD\]\*\*$/, // Instrucción de subtítulo específica
        /^\*\*Free\/Low-Cost Resources Mentioned:\*\*$/, // Encabezado de sección específico
        /^\*\*Your Turn:\*\*$/, // Encabezado de sección específico
        /^\*\*Conclusion:\*\* \[Generate a brief final summary of the benefit or main idea\.\]$/, // Instrucción de conclusión específica
        /^\s*\[Generate a brief and catchy introduction here, grabbing attention and presenting the problem\/benefit\.\]\s*$/, // Marcadores de posición instruccionales generales
        /^\s*\[Generate content here that contextualizes the common situation small businesses face\.\]\s*$/,
        /^\s*\[Generate the content for the \"Solution\" with practical tactics, tips, and strategies\. Use bullet points for steps or key takeaways\.\]\s*$/,
        /^\* \*Step-by-Step or Key Points:\*\* Break down information into easy-to-follow sections\.$/, // Instrucciones de puntos específicos
        /^\* \*Brief Examples\/Hypothetical Cases:\*\* Illustrate points with scenarios that resonate with entrepreneurs\.$/,
        /^\* \*Pro-Tip\/Common Pitfalls:\*\* Share warnings and shortcuts based on experience\.$/,
        /^\[Resource \d\]: Brief description and why it's valuable\.$/,
        /^\(Ensure these are resources from reliable companies and mostly free or low-cost\)\.$/,
        /^\s*\[Generate a Call-to-Action \(CTA\) here to encourage the community to comment, share experiences, or ask questions\.\]\s*$/,
        /^\s*\[Generate a brief final summary of the benefit or main idea\.\]\s*$/,
        // NEW: Add a pattern to remove the title if it's duplicated at the very beginning of the content
        new RegExp(`^\*\*${currentArticleDraft?.title || 'NO_TITLE_MATCH'}\*\*\s*, 'i'), // Match bold title at start
        new RegExp(`^${currentArticleDraft?.title || 'NO_TITLE_MATCH'}\s*, 'i') // Match plain title at start
    ];

    for (const line of lines) {
        let isInstructional = false;
        for (const pattern of instructionalPatterns) {
            if (pattern.test(line)) {
                isInstructional = true;
                break;
            }
        }
        if (!isInstructional) {
            cleanedLines.push(line);
        }
    }

    // Eliminar líneas vacías iniciales/finales y colapsar múltiples líneas vacías en una
    return cleanedLines
        .filter((line, index, arr) => {
            const isBlank = line.trim() === '';
            const isPrevBlank = index > 0 && arr[index - 1].trim() === '';
            return !(isBlank && isPrevBlank);
        })
        .join('\n')
        .trim();
};


const App = () => {
    const [db, setDb] = useState(null);
    const [auth, setAuth] = useState(null);
    const [userId, setUserId] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const [suggestedIdeas, setSuggestedIdeas] = useState([]);
    const [currentArticleDraft, setCurrentArticleDraft] = useState(null);
    const [articles, setArticles] = useState([]);
    const [viewingArticle, setViewingArticle] = useState(null); // Para ver un artículo específico del historial
    const [redditTrends, setRedditTrends] = useState([]);
    const [selectedSubreddit, setSelectedSubreddit] = useState('growmybusinessnow');

    const flairs = [
        "🚀 Growth Hacks & Breakthroughs",
        "💡 Freebie Fortune Finders",
        "📈 Digital Domination Playbook",
        "💸 Profit Pathways & Funding Funnel"
    ];

    // --- Reddit API Integration ---
    const fetchRedditTrends = async () => {
        setLoading(true);
        setError(null);
        try {
            const trendsData = await fetchTrends(selectedSubreddit);
            setRedditTrends(trendsData);
        } catch (err) {
            console.error("Error fetching Reddit trends:", err);
            setError(`Error fetching Reddit trends: ${err.message}`);
        } finally {
            setLoading(false);
        }
    };


    // Inicialización y Autenticación de Firebase
    useEffect(() => {
        const initFirebase = async () => {
            try {
                // Determinar si se proporciona una configuración real de Firebase (desde Canvas o explícitamente por el usuario)
                const isRealFirebaseConfig = firebaseConfig.apiKey && firebaseConfig.apiKey !== "dummy-api-key-for-local-dev";

                if (isRealFirebaseConfig) {
                    const app = initializeApp(firebaseConfig);
                    const firestore = getFirestore(app);
                    const authInstance = getAuth(app);
                    setDb(firestore);
                    setAuth(authInstance);

                    onAuthStateChanged(authInstance, async (user) => {
                        if (user) {
                            setUserId(user.uid);
                        } else {
                            if (initialAuthToken) { // Este token solo está disponible en Canvas
                                await signInWithCustomToken(authInstance, initialAuthToken);
                            } else {
                                // Para aplicaciones desplegadas (no Canvas) o desarrollo local sin token, iniciar sesión anónimamente
                                await signInAnonymously(authInstance);
                            }
                        }
                        setLoading(false); // Establecer loading en false después de determinar el estado de autenticación
                    });
                } else {
                    // Ejecutando sin una conexión real a Firebase (desarrollo local o desplegado sin configuración)
                    console.warn("Ejecutando sin una conexión real a Firebase. Las operaciones de Firestore no se persistirán.");
                    setLoading(false);
                    setUserId("local-dev-user"); // ID de usuario ficticio para operaciones en memoria
                    setDb(null); // Asegurar que db sea null
                    setAuth(null); // Asegurar que auth sea null
                }

            } catch (err) {
                console.error("Error al inicializar Firebase:", err);
                setError("Error al inicializar la aplicación. Asegúrate de que la configuración de Firebase sea correcta.");
                setLoading(false);
            }
        };

        initFirebase();
    }, []);

    // Obtener ideas y artículos cuando userId esté disponible
    useEffect(() => {
        // Solo intentar obtener de Firestore si db está inicializado y userId no es el ficticio "local-dev-user"
        if (!db || userId === "local-dev-user") {
            // Para el desarrollo local o modo sin DB, no se obtendrá/guardará en Firestore.
            // Las ideas y los artículos serán transitorios en memoria.
            return;
        }

        // Obtener ideas sugeridas (privadas del usuario)
        const ideasCollectionRef = collection(db, `artifacts/${appId}/users/${userId}/article_ideas`);
        const qIdeas = query(ideasCollectionRef);
        const unsubscribeIdeas = onSnapshot(qIdeas, (snapshot) => {
            const ideasData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setSuggestedIdeas(ideasData);
        }, (err) => {
            console.error("Error al obtener ideas:", err);
            setError("Error al cargar ideas.");
        });

        // Obtener artículos (públicos para la aplicación)
        const articlesCollectionRef = collection(db, `artifacts/${appId}/public/data/articles`);
        const qArticles = query(articlesCollectionRef);
        const unsubscribeArticles = onSnapshot(qArticles, (snapshot) => {
            const articlesData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setArticles(articlesData);
        }, (err) => {
            console.error("Error al obtener artículos:", err);
            setError("Error al cargar artículos.");
        });

        return () => {
            unsubscribeIdeas();
            unsubscribeArticles();
        };
    }, [db, userId]);

    // Generar Ideas de Artículos
    const generateIdeas = async () => {
        setLoading(true);
        setError(null);
        try {
            if (!db) {
                console.warn("Firestore no conectado. Generando ideas en memoria.");
            }

            let prompt;
            if (redditTrends.length > 0) {
                const trendingTitles = redditTrends.map(post => `- "${post.title}"`).join('\n');
                prompt = `You are an expert content strategist for the Reddit community r/${selectedSubreddit}`;

                prompt += `

Based on the following list of currently popular post titles from the community:
${trendingTitles}

Generate 5 new, attractive, and valuable article title ideas that capture a similar style or address related topics. The goal is to create content that will resonate strongly with the community. Focus on practical, actionable strategies for small businesses in the USA, using free or low-cost resources.

Assign each new idea to one of the following flairs:
- 🚀 Growth Hacks & Breakthroughs
- 💡 Freebie Fortune Finders
- 📈 Digital Domination Playbook
- 💸 Profit Pathways & Funding Funnel

Output format JSON:
[
    { "title": "New Idea Title 1", "flair": "Corresponding Flair" },
    { "title": "New Idea Title 2", "flair": "Corresponding Flair" },
    ...
]`;
            } else {
                prompt = `Generate 5 attractive and valuable article title ideas for a Reddit community named r/${selectedSubreddit}, focused on growth strategies for small businesses and entrepreneurs in the USA, using free or low-cost resources. Articles should be practical and actionable.
            Assign each idea to one of the following flairs:
            - 🚀 Growth Hacks & Breakthroughs
            - 💡 Freebie Fortune Finders
            - 📈 Digital Domination Playbook
            - 💸 Profit Pathways & Funding Funnel

            Output format JSON:
            [
                { "title": "Idea Title 1", "flair": "Corresponding Flair" },
                { "title": "Idea Title 2", "flair": "Corresponding Flair" },
                ...
            ]`;
            }

            const schema = {
                type: "ARRAY",
                items: {
                    type: "OBJECT",
                    properties: {
                        "title": { "type": "STRING" },
                        "flair": { "type": "STRING" }
                    },
                    "propertyOrdering": ["title", "flair"]
                }
            };

            const newIdeas = await callGeminiAPI(prompt, true, schema);
            if (newIdeas) {
                if (db) { // Solo guardar en Firestore si db está realmente conectado
                    const ideasCollectionRef = collection(db, `artifacts/${appId}/users/${userId}/article_ideas`);
                    for (const idea of newIdeas) {
                        await addDoc(ideasCollectionRef, { ...idea, status: 'pending', createdAt: new Date() });
                    }
                } else {
                    // Para el desarrollo local/modo sin DB, gestionar ideas en memoria
                    setSuggestedIdeas(prev => [...prev, ...newIdeas.map(idea => ({ ...idea, id: Math.random().toString(36).substring(2, 9), status: 'pending', createdAt: new Date() }))]);
                }
            }
        } catch (err) {
            setError(`Error al generar ideas: ${err.message}`);
        } finally {
            setLoading(false);
        }
    };

    // Generar Borrador de Artículo Completo
    const generateArticleDraft = async (idea) => {
        setLoading(true);
        setError(null);
        try {
            const articlePrompt = `Write a detailed and valuable article in ENGLISH for the Reddit community r/${selectedSubreddit}, with the title "**${idea.title}**" and under the flair "${idea.flair}".
The article must be practical, actionable, and focused on growth strategies for small businesses and entrepreneurs in the USA, leveraging free or low-cost online resources.
Ensure that the main article title is provided in the prompt's structure, and **do NOT repeat the title within the article's introduction or body content.**
All subtitles within the body of the article must be in **bold Markdown** (using **text**).
Make the language engaging, conversational, and easy to read. Use varied sentence structures and clear, concise points.
Do NOT include any bracketed instructions like "[Generate content here]" or "---" separators in the final article output. Generate the actual content directly for each section.

Follow this structure:

**${idea.title}**

Hey, fellow entrepreneurs!

[Generate a brief and catchy introduction here, grabbing attention and presenting the problem/benefit. Do NOT repeat the title in this section.]

**The Challenge:** [Generate content here that contextualizes the common situation small businesses face.]

**[Generate a compelling subtitle for the Solution/Guide - IN BOLD]**

[Generate the content for the "Solution" with practical tactics, tips, and strategies. Use bullet points for steps or key takeaways.]
* **Step-by-Step or Key Points:** Break down information into easy-to-follow sections.
* **Brief Examples/Hypothetical Cases:** Illustrate points with scenarios that resonate with entrepreneurs.
* **Pro-Tip/Common Pitfalls:** Share warnings and shortcuts based on experience.

**Free/Low-Cost Resources Mentioned:**

* [Resource 1]: Brief description and why it's valuable.
* [Resource 2]: Brief description and why it's valuable.
(Ensure these are resources from reliable companies and mostly free or low-cost).

**Your Turn:**

[Generate a Call-to-Action (CTA) here to encourage the community to comment, share experiences, or ask questions.]

**Conclusion:** [Generate a brief final summary of the benefit or main idea.]

The content should be attractive, easy to read, and highly useful. The tone should be optimistic and empowering.
`;

            const draft = await callGeminiAPI(articlePrompt);
            if (draft) {
                setCurrentArticleDraft({
                    title: idea.title,
                    flair: idea.flair,
                    content: draft,
                    status: 'draft',
                    createdAt: new Date(),
                    ideaId: idea.id // Enlazar a la idea original
                });
                // Actualizar el estado de la idea a 'approved' en Firestore (si hay DB real) o en memoria (si es local)
                if (db) { // Solo actualizar en Firestore si db está realmente conectado
                    const ideaDocRef = doc(db, `artifacts/${appId}/users/${userId}/article_ideas`, idea.id);
                    await updateDoc(ideaDocRef, { status: 'approved' });
                } else {
                    setSuggestedIdeas(prev => prev.map(item => item.id === idea.id ? { ...item, status: 'approved' } : item));
                }
            }
        } catch (err) {
            setError(`Error al generar el borrador del artículo: ${err.message}`);
        } finally {
            setLoading(false);
        }
    };

    // Guardar Artículo en la Colección Pública
    const publishArticle = async () => {
        if (!currentArticleDraft) {
            setError("No hay borrador de artículo para publicar.");
            return;
        }

        setLoading(true);
        try {
            if (db) { // Solo guardar en Firestore si db está realmente conectado
                const articlesCollectionRef = collection(db, `artifacts/${appId}/public/data/articles`);
                await addDoc(articlesCollectionRef, {
                    ...currentArticleDraft,
                    status: 'published',
                    publishedAt: new Date(),
                    authorId: userId // Guardar el ID del autor
                });
                alert("¡Artículo guardado en el historial de tu aplicación!");
            } else {
                // Para el desarrollo local/modo sin DB, gestionar artículos en memoria
                setArticles(prev => [...prev, { ...currentArticleDraft, id: Math.random().toString(36).substring(2, 9), status: 'published', publishedAt: new Date() }]);
                alert("¡Artículo guardado en el historial de tu aplicación (solo en memoria, no persistido)!");
            }
            setCurrentArticleDraft(null); // Borrar el borrador actual
        } catch (err) {
            console.error("Error al publicar artículo:", err);
            setError("Error al guardar el artículo.");
        } finally {
            setLoading(false);
        }
    };

    const rejectIdea = async (ideaId) => {
        if (db) { // Solo intentar la actualización de Firestore si db está realmente conectado
            try {
                const ideaDocRef = doc(db, `artifacts/${appId}/users/${userId}/article_ideas`, ideaId);
                await updateDoc(ideaDocRef, { status: 'rejected' });
            } catch (err) {
                console.error("Error al rechazar idea:", err);
                setError("Error al rechazar la idea.");
            }
        } else {
            // Si no hay conexión real a la DB, realizar la actualización en memoria
            console.warn("Firestore no conectado. Rechazando idea en memoria.");
            setSuggestedIdeas(prev => prev.map(item => item.id === ideaId ? { ...item, status: 'rejected' } : item));
            setError(null); // Limpiar cualquier error previo si se maneja en memoria
        }
    };

    // Nueva función para exportar datos del artículo como CSV para Google Sheet
    const handleExportToSheet = () => {
        if (!currentArticleDraft) {
            alert("Por favor, genera un borrador de artículo primero.");
            return;
        }

        const cleanedContent = cleanArticleContent(currentArticleDraft.content);
        // Formato CSV básico: escapar comillas dobles y encerrar entre comillas si hay comas
        const escapeCsv = (text) => {
            if (text.includes(',') || text.includes('"') || text.includes('\n')) {
                return `"${text.replace(/"/g, '""')}"`;
            }
            return text;
        };

        const csvData = [
            escapeCsv(currentArticleDraft.title),
            escapeCsv(currentArticleDraft.flair),
            escapeCsv(cleanedContent)
        ].join(',');

        copyToClipboard(csvData);
        alert(
            "Datos del artículo (Título, Flair, Contenido) copiados como CSV!\n\n" +
            "Ahora, ve a tu Hoja de Google, selecciona una celda y pega (Ctrl+V o Cmd+V) para añadir este artículo para Make.com."
        );
    };

    // Nueva función para simular la publicación en Reddit a través de un backend (ej. Cloudflare Worker)
    const handlePublishToRedditBackend = async () => {
        if (!currentArticleDraft) {
            alert("Por favor, genera un borrador de artículo primero.");
            return;
        }

        setLoading(true);
        setError(null);
        try {
            const cleanedContent = cleanArticleContent(currentArticleDraft.content);
            const result = await publishToReddit({
                title: currentArticleDraft.title,
                flair: currentArticleDraft.flair,
                content: cleanedContent,
                subreddit: selectedSubreddit
            });
            alert(`¡Artículo enviado exitosamente al backend para publicación en Reddit! Estado: ${result.status || 'Éxito'}`);
            await publishArticle();
        } catch (err) {
            alert(`Fallo al enviar el artículo al backend para publicación en Reddit: ${err.message}`);
        } finally {
            setLoading(false);
        }
    };



    if (loading && !userId) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-100 p-4">
                <div className="bg-white p-6 rounded-lg shadow-md text-center">
                    <p className="text-lg font-semibold text-gray-700">Cargando aplicación y autenticando...</p>
                    <div className="mt-4 animate-spin rounded-full h-12 w-12 border-b-2 border-green-500 mx-auto"></div>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-red-100 p-4">
                <div className="bg-white p-6 rounded-lg shadow-md text-center">
                    <p className="text-lg font-semibold text-red-700">Error:</p>
                    <p className="text-gray-600 mt-2">{error}</p>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gray-50 font-inter text-gray-800 p-4 sm:p-6 lg:p-8">
            <header className="bg-white shadow-sm rounded-lg p-4 mb-6 flex flex-col sm:flex-row justify-between items-center">
                <h1 className="text-2xl sm:text-3xl font-bold text-green-700 mb-2 sm:mb-0">
                    <span className="text-gray-600">r/</span>growmybusinessnow Content Assistant
                </h1>
                <div className="text-sm text-gray-500">
                    ID de Usuario: <span className="font-mono text-gray-700 break-all">{userId}</span>
                </div>
            </header>

            <main className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Panel de Tendencias de Reddit */}
                <section className="lg:col-span-1 bg-white p-6 rounded-lg shadow-md flex flex-col">
                    <h2 className="text-xl font-semibold text-gray-700 mb-4">Tendencias de Reddit</h2>
                    <div className="flex gap-2 mb-4">
                        <input
                            type="text"
                            value={selectedSubreddit}
                            onChange={(e) => setSelectedSubreddit(e.target.value)}
                            placeholder="ej. entrepreneurs"
                            className="flex-grow p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent transition"
                        />
                        <button
                            onClick={fetchRedditTrends}
                            className="bg-orange-500 hover:bg-orange-600 text-white font-bold py-2 px-4 rounded-lg shadow-md transition duration-300 ease-in-out"
                            disabled={loading}
                        >
                            {loading ? 'Analizando...' : 'Analizar'}
                        </button>
                    </div>

                    {redditTrends.length === 0 && !loading && (
                        <p className="text-gray-500 text-center mt-4">Analiza las tendencias para ver los posts populares.</p>
                    )}

                    <div className="space-y-3 flex-grow overflow-y-auto max-h-[400px] lg:max-h-[unset]">
                        {redditTrends.map((post) => (
                            <div key={post.id} className="p-3 border border-gray-200 rounded-lg bg-gray-50">
                                <a href={`https://reddit.com${post.permalink}`} target="_blank" rel="noopener noreferrer" className="text-lg font-medium text-blue-600 hover:underline">{post.title}</a>
                                <div className="text-sm text-gray-500 mt-1">
                                    <span>Upvotes: {post.score}</span> | <span>Comentarios: {post.num_comments}</span>
                                </div>
                            </div>
                        ))}
                    </div>
                </section>

                {/* Panel de Ideas Sugeridas */}
                <section className="lg:col-span-1 bg-white p-6 rounded-lg shadow-md flex flex-col">
                    <h2 className="text-xl font-semibold text-gray-700 mb-4">Ideas Sugeridas</h2>
                    <button
                        onClick={generateIdeas}
                        className="bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded-lg shadow-md transition duration-300 ease-in-out mb-4 w-full"
                        disabled={loading}
                    >
                        {loading ? 'Generando...' : 'Generar Nuevas Ideas'}
                    </button>

                    {suggestedIdeas.length === 0 && !loading && (
                        <p className="text-gray-500 text-center mt-4">Haz clic en "Generar Nuevas Ideas" para empezar.</p>
                    )}

                    <div className="space-y-3 flex-grow overflow-y-auto max-h-[400px] lg:max-h-[unset]">
                        {suggestedIdeas.filter(idea => idea.status === 'pending').map((idea) => (
                            <div key={idea.id} className="p-4 border border-gray-200 rounded-lg bg-gray-50">
                                <p className="text-lg font-medium text-gray-800">{idea.title}</p>
                                <span className="text-sm text-green-600 font-semibold">{idea.flair}</span>
                                <div className="mt-3 flex space-x-2">
                                    <button
                                        onClick={() => generateArticleDraft(idea)}
                                        className="flex-1 bg-blue-500 hover:bg-blue-600 text-white text-sm py-2 px-3 rounded-md transition duration-300"
                                        disabled={loading}
                                    >
                                        {loading ? 'Generando...' : 'Aprobar y Generar Borrador'}
                                    </button>
                                    <button
                                        onClick={() => rejectIdea(idea.id)}
                                        className="bg-red-500 hover:bg-red-600 text-white text-sm py-2 px-3 rounded-md transition duration-300"
                                        disabled={loading}
                                    >
                                        Rechazar
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                </section>

                {/* Panel de Borrador de Artículo */}
                <section className="lg:col-span-1 bg-white p-6 rounded-lg shadow-md flex flex-col">
                    <h2 className="text-xl font-semibold text-gray-700 mb-4">Borrador de Artículo</h2>
                    {loading && (
                        <div className="text-center py-8">
                            <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-green-500 mx-auto"></div>
                            <p className="mt-4 text-gray-600">Generando borrador, por favor espera...</p>
                        </div>
                    )}
                    {currentArticleDraft ? (
                        <div className="flex-grow flex flex-col">
                            <h3 className="text-2xl font-bold text-gray-900 mb-2">{currentArticleDraft.title}</h3>
                            <span className="text-md text-green-600 font-semibold mb-4">{currentArticleDraft.flair}</span>
                            <div className="bg-gray-50 p-4 rounded-lg border border-gray-200 flex-grow overflow-y-auto max-h-[500px] lg:max-h-[unset] prose prose-sm sm:prose lg:prose-lg">
                                {/* Usando dangerouslySetInnerHTML para renderizar Markdown */}
                                <div dangerouslySetInnerHTML={{ __html: currentArticleDraft.content.replace(/\n/g, '<br/>') }} />
                            </div>
                            <div className="mt-4 flex flex-col sm:flex-row space-y-3 sm:space-y-0 sm:space-x-3">
                                <button
                                    onClick={publishArticle}
                                    className="flex-1 bg-purple-600 hover:bg-purple-700 text-white font-bold py-2 px-4 rounded-lg shadow-md transition duration-300 ease-in-out"
                                    disabled={loading}
                                >
                                    Guardar en Historial de la App
                                </button>
                                <button
                                    onClick={() => copyToClipboard(cleanArticleContent(currentArticleDraft.content))}
                                    className="flex-1 bg-gray-200 hover:bg-gray-300 text-gray-800 font-bold py-2 px-4 rounded-lg shadow-md transition duration-300 ease-in-out"
                                >
                                    Copiar Contenido Limpio
                                </button>
                                <button
                                    onClick={handleExportToSheet} // Nuevo botón para exportar a Google Sheet
                                    className="flex-1 bg-orange-500 hover:bg-orange-600 text-white font-bold py-2 px-4 rounded-lg shadow-md transition duration-300 ease-in-out"
                                    disabled={loading}
                                >
                                    Exportar a Hoja de Google (Copiar Datos)
                                </button>
                                <button
                                    onClick={handlePublishToRedditBackend} // Nuevo botón para publicar directamente en Reddit a través del backend
                                    className="flex-1 bg-red-700 hover:bg-red-800 text-white font-bold py-2 px-4 rounded-lg shadow-md transition duration-300 ease-in-out"
                                    disabled={loading}
                                >
                                    Publicar en Reddit (vía Backend)
                                </button>
                                <button
                                    onClick={() => setCurrentArticleDraft(null)}
                                    className="flex-1 bg-red-500 hover:bg-red-600 text-white font-bold py-2 px-4 rounded-lg shadow-md transition duration-300 ease-in-out"
                                >
                                    Descartar Borrador
                                </button>
                            </div>
                        </div>
                    ) : (
                        <p className="text-gray-500 text-center mt-8">
                            Selecciona una idea para generar un borrador de artículo aquí.
                        </p>
                    )}
                </section>

                {/* Historial de Artículos Publicados */}
                <section className="lg:col-span-3 bg-white p-6 rounded-lg shadow-md mt-6">
                    <h2 className="text-xl font-semibold text-gray-700 mb-4">Mis Artículos Publicados</h2>
                    {articles.length === 0 && !loading && (
                        <p className="text-gray-500 text-center">Aún no hay artículos publicados.</p>
                    )}
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {articles.map((article) => (
                            <div key={article.id} className="p-4 border border-gray-200 rounded-lg bg-gray-50">
                                <h3 className="text-lg font-medium text-gray-800">{article.title}</h3>
                                <span className="text-sm text-green-600 font-semibold">{article.flair}</span>
                                <p className="text-xs text-gray-500 mt-1">
                                    Publicado: {article.publishedAt && new Date(article.publishedAt.toDate ? article.publishedAt.toDate() : article.publishedAt).toLocaleDateString()}
                                </p>
                                <button
                                    onClick={() => setViewingArticle(article)}
                                    className="mt-3 bg-blue-500 hover:bg-blue-600 text-white text-sm py-1.5 px-3 rounded-md transition duration-300 w-full"
                                >
                                    Ver Artículo
                                </button>
                            </div>
                        ))}
                    </div>

                    {/* Modal para ver el artículo completo */}
                    {viewingArticle && (
                        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
                            <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-3xl max-h-[90vh] overflow-y-auto relative">
                                <button
                                    onClick={() => setViewingArticle(null)}
                                    className="absolute top-3 right-3 text-gray-500 hover:text-gray-800 text-2xl font-bold"
                                >
                                    &times;
                                </button>
                                <h3 className="text-2xl font-bold text-gray-900 mb-2">{viewingArticle.title}</h3>
                                <span className="text-md text-green-600 font-semibold mb-4">{viewingArticle.flair}</span>
                                <div className="prose prose-sm sm:prose lg:prose-lg mt-4">
                                    {/* Usando dangerouslySetInnerHTML para renderizar Markdown */}
                                    <div dangerouslySetInnerHTML={{ __html: viewingArticle.content.replace(/\n/g, '<br/>') }} />
                                </div>
                                <button
                                    onClick={() => copyToClipboard(cleanArticleContent(viewingArticle.content))}
                                    className="mt-6 bg-gray-200 hover:bg-gray-300 text-gray-800 font-bold py-2 px-4 rounded-lg shadow-md transition duration-300 ease-in-out w-full"
                                >
                                    Copiar Contenido Limpio
                                </button>
                            </div>
                        </div>
                    )}
                </section>
            </main>
        </div>
    );
};

export default App;