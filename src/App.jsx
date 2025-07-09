import React, { useState, useEffect, useCallback } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, addDoc, query, orderBy, onSnapshot, doc, updateDoc, getDocs } from 'firebase/firestore';

// Global variables provided by the Canvas environment
// When running locally, these will be undefined, so we provide fallbacks.
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {
    // Dummy Firebase config for local development.
    // This allows the app to initialize Firebase locally without crashing,
    // but it won't connect to a real Firestore database.
    // Replace with your actual Firebase config if you want local database access.
    apiKey: "dummy-api-key",
    authDomain: "dummy-auth-domain",
    projectId: "dummy-project-id",
    storageBucket: "dummy-storage-bucket",
    messagingSenderId: "dummy-messaging-sender-id",
    appId: "dummy-app-id"
};
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

// Utility function to copy text to clipboard
const copyToClipboard = (text) => {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    try {
        document.execCommand('copy');
        alert('Content copied to clipboard!'); // Using alert for simplicity, would use custom modal in production
    } catch (err) {
        console.error('Error copying to clipboard: ', err);
        alert('Error copying content to clipboard.');
    }
    document.body.removeChild(textarea);
};

// Utility function to clean article content before copying
const cleanArticleContent = (rawContent) => {
    const lines = rawContent.split('\n');
    const cleanedLines = [];

    const instructionalPatterns = [
        /^\s*---\s*$/, // Markdown separators
        /^Hey, fellow entrepreneurs!/, // Specific intro line
        /^\*\*The Challenge:\*\* \[Generate content here that contextualizes the common situation small businesses face\.\]$/, // Instructional placeholder for challenge
        /^\*\*\[Generate a compelling subtitle for the Solution\/Guía - IN BOLD\]\*\*$/, // Specific subtitle instruction
        /^\*\*Free\/Low-Cost Resources Mentioned:\*\*$/, // Specific section header
        /^\*\*Your Turn:\*\*$/, // Specific section header
        /^\*\*Conclusion:\*\* \[Generate a brief final summary of the benefit or main idea\.\]$/, // Specific conclusion instruction
        /^\s*\[Generate a brief and catchy introduction here, grabbing attention and presenting the problem\/benefit\.\]\s*$/, // General instructional placeholders
        /^\s*\[Generate content here that contextualizes the common situation small businesses face\.\]\s*$/,
        /^\s*\[Generate the content for the "Solution" with practical tactics, tips, and strategies\. Use bullet points for steps or key takeaways\.\]\s*$/,
        /^\* \*\*Step-by-Step or Key Points:\*\* Break down information into easy-to-follow sections\.$/, // Specific bullet point instructions
        /^\* \*\*Brief Examples\/Hypothetical Cases:\*\* Illustrate points with scenarios that resonate with entrepreneurs\.$/,
        /^\* \*\*Pro-Tip\/Common Pitfalls:\*\* Share warnings and shortcuts based on experience\.$/,
        /^\[Resource \d\]: Brief description and why it's valuable\.$/,
        /^\(Ensure these are resources from reliable companies and mostly free or low-cost\)\.$/,
        /^\s*\[Generate a Call-to-Action \(CTA\) here to encourage the community to comment, share experiences, or ask questions\.\]\s*$/,
        /^\s*\[Generate a brief final summary of the benefit or main idea\.\]\s*$/,
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

    // Remove leading/trailing empty lines and collapse multiple empty lines into one
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
    const [viewingArticle, setViewingArticle] = useState(null); // To view a specific article from history

    const flairs = [
        "🚀 Growth Hacks & Breakthroughs",
        "💡 Freebie Fortune Finders",
        "📈 Digital Domination Playbook",
        "💸 Profit Pathways & Funding Funnel"
    ];

    // Firebase Initialization and Authentication
    useEffect(() => {
        const initFirebase = async () => {
            try {
                // Only initialize Firebase if a valid config is provided (i.e., not the dummy local one)
                // or if it's running in the Canvas environment.
                const isCanvasEnv = typeof __firebase_config !== 'undefined';
                const hasRealConfig = firebaseConfig.apiKey && firebaseConfig.apiKey !== "dummy-api-key";

                let app;
                if (isCanvasEnv || hasRealConfig) {
                    app = initializeApp(firebaseConfig);
                    const firestore = getFirestore(app);
                    const authInstance = getAuth(app);
                    setDb(firestore);
                    setAuth(authInstance);

                    // Listen for auth state changes
                    onAuthStateChanged(authInstance, async (user) => {
                        if (user) {
                            setUserId(user.uid);
                            setLoading(false);
                        } else {
                            if (initialAuthToken) {
                                await signInWithCustomToken(authInstance, initialAuthToken);
                            } else {
                                await signInAnonymously(authInstance);
                            }
                        }
                    });
                } else {
                    // For local development without real Firebase, just set loading to false
                    // and provide a dummy userId to allow UI interaction.
                    console.warn("Running in local development mode without real Firebase connection.");
                    setLoading(false);
                    setUserId("local-dev-user"); // Dummy user ID for local testing
                }

            } catch (err) {
                console.error("Error initializing Firebase:", err);
                setError("Error initializing the application. Please try again.");
                setLoading(false);
            }
        };

        initFirebase();
    }, []);

    // Fetch ideas and articles when userId is available
    useEffect(() => {
        // Only attempt to fetch from Firestore if db is initialized and userId is real (not dummy local-dev-user)
        if (!db || !userId || userId === "local-dev-user") {
            // For local dev, we won't fetch/save to Firestore unless real config is present.
            // Ideas and articles will be transient in memory.
            return;
        }

        // Fetch suggested ideas (private to user)
        const ideasCollectionRef = collection(db, `artifacts/${appId}/users/${userId}/article_ideas`);
        const qIdeas = query(ideasCollectionRef);
        const unsubscribeIdeas = onSnapshot(qIdeas, (snapshot) => {
            const ideasData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setSuggestedIdeas(ideasData);
        }, (err) => {
            console.error("Error fetching ideas:", err);
            setError("Error loading ideas.");
        });

        // Fetch articles (public for the app)
        const articlesCollectionRef = collection(db, `artifacts/${appId}/public/data/articles`);
        const qArticles = query(articlesCollectionRef);
        const unsubscribeArticles = onSnapshot(qArticles, (snapshot) => {
            const articlesData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setArticles(articlesData);
        }, (err) => {
            console.error("Error fetching articles:", err);
            setError("Error loading articles.");
        });

        return () => {
            unsubscribeIdeas();
            unsubscribeArticles();
        };
    }, [db, userId]);

    // LLM API Call function
    const callGeminiAPI = async (prompt, isStructured = false, schema = {}) => {
        setLoading(true);
        setError(null);
        try {
            let chatHistory = [{ role: "user", parts: [{ text: prompt }] }];
            const payload = { contents: chatHistory };

            if (isStructured) {
                payload.generationConfig = {
                    responseMimeType: "application/json",
                    responseSchema: schema
                };
            }

            // When running locally, the API key might not be available.
            // The Canvas environment injects it. For local testing of AI generation,
            // you might need to manually set an API key here if you have one,
            // or understand that AI generation won't work locally without it.
            const apiKey = "AIzaSyDtpEEXOTuBCmrGNqz-uDExRZeTn_jqYPI"; // Canvas will provide this at runtime
            const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(`API error: ${response.status} - ${errorData.error.message || 'Unknown error'}`);
            }

            const result = await response.json();

            if (result.candidates && result.candidates.length > 0 && result.candidates[0].content && result.candidates[0].content.parts && result.candidates[0].content.parts.length > 0) {
                const text = result.candidates[0].content.parts[0].text;
                return isStructured ? JSON.parse(text) : text;
            } else {
                throw new Error("Unexpected response from Gemini API.");
            }
        } catch (err) {
            console.error("Error calling Gemini API:", err);
            setError(`Error generating content: ${err.message}`);
            return null;
        } finally {
            setLoading(false);
        }
    };

    // Generate Article Ideas
    const generateIdeas = async () => {
        if (!db && userId !== "local-dev-user") { // Only allow if db is ready or in local-dev mode
            setError("Application is not ready. Please wait.");
            return;
        }

        const prompt = `Generate 5 attractive and valuable article title ideas for a Reddit community named r/growmybusinessnow, focused on growth strategies for small businesses and entrepreneurs in the USA, using free or low-cost resources. Articles should be practical and actionable.
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
            if (db && userId !== "local-dev-user") { // Only save to Firestore if real db connection
                const ideasCollectionRef = collection(db, `artifacts/${appId}/users/${userId}/article_ideas`);
                for (const idea of newIdeas) {
                    await addDoc(ideasCollectionRef, { ...idea, status: 'pending', createdAt: new Date() });
                }
            } else {
                // For local dev, manage ideas in memory
                setSuggestedIdeas(prev => [...prev, ...newIdeas.map(idea => ({ ...idea, id: Math.random().toString(36).substring(2, 9), status: 'pending', createdAt: new Date() }))]);
            }
        }
    };

    // Generate Full Article Draft
    const generateArticleDraft = async (idea) => {
        if (!db && userId !== "local-dev-user") { // Only allow if db is ready or in local-dev mode
            setError("Application is not ready. Please wait.");
            return;
        }

        const articlePrompt = `Write a detailed and valuable article in ENGLISH for the Reddit community r/growmybusinessnow, with the title "**${idea.title}**" and under the flair "${idea.flair}".
        The article must be practical, actionable, and focused on growth strategies for small businesses and entrepreneurs in the USA, leveraging free or low-cost online resources.
        Ensure that the main article title and ALL subtitles within the body of the article are in **bold Markdown** (using **text**).
        Make the language engaging, conversational, and easy to read. Use varied sentence structures and clear, concise points.
        Do NOT include any bracketed instructions like "[Generate content here]" or "---" separators in the final article output. Generate the actual content directly for each section.

        Follow this structure:

        **${idea.title}**

        Hey, fellow entrepreneurs!

        [Generate a brief and catchy introduction here, grabbing attention and presenting the problem/benefit.]

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
                ideaId: idea.id // Link to the original idea
            });
            // Update idea status to 'approved' in Firestore (if real db) or memory (if local)
            if (db && userId !== "local-dev-user") {
                const ideaDocRef = doc(db, `artifacts/${appId}/users/${userId}/article_ideas`, idea.id);
                await updateDoc(ideaDocRef, { status: 'approved' });
            } else {
                setSuggestedIdeas(prev => prev.map(item => item.id === idea.id ? { ...item, status: 'approved' } : item));
            }
        }
    };

    // Save Article to Public Collection
    const publishArticle = async () => {
        if (!currentArticleDraft) {
            setError("No article draft to publish.");
            return;
        }

        setLoading(true);
        try {
            if (db && userId !== "local-dev-user") { // Only save to Firestore if real db connection
                const articlesCollectionRef = collection(db, `artifacts/${appId}/public/data/articles`);
                await addDoc(articlesCollectionRef, {
                    ...currentArticleDraft,
                    status: 'published',
                    publishedAt: new Date(),
                    authorId: userId // Store the author's ID
                });
            } else {
                // For local dev, manage articles in memory
                setArticles(prev => [...prev, { ...currentArticleDraft, id: Math.random().toString(36).substring(2, 9), status: 'published', publishedAt: new Date() }]);
            }
            setCurrentArticleDraft(null); // Clear the current draft
            alert("Article saved to your app history!"); // Changed alert message
        } catch (err) {
            console.error("Error publishing article:", err);
            setError("Error saving the article."); // Changed error message
        } finally {
            setLoading(false);
        }
    };

    const rejectIdea = async (ideaId) => {
        if (!db && userId !== "local-dev-user") { // Allow rejection in local dev without db
            setSuggestedIdeas(prev => prev.map(item => item.id === ideaId ? { ...item, status: 'rejected' } : item));
            return;
        }
        try {
            const ideaDocRef = doc(db, `artifacts/${appId}/users/${userId}/article_ideas`, ideaId);
            await updateDoc(ideaDocRef, { status: 'rejected' });
        } catch (err) {
            console.error("Error rejecting idea:", err);
            setError("Error rejecting the idea.");
        }
    };

    // New function to export article data as CSV for Google Sheet
    const handleExportToSheet = () => {
        if (!currentArticleDraft) {
            alert("Please generate an article draft first.");
            return;
        }

        const cleanedContent = cleanArticleContent(currentArticleDraft.content);
        // Basic CSV formatting: escape double quotes and enclose in quotes if comma exists
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
            "Article data (Title, Flair, Content) copied as CSV!\n\n" +
            "Now, go to your Google Sheet, select a cell, and paste (Ctrl+V or Cmd+V) to add this article for Make.com."
        );
    };

    // New function to simulate publishing to Reddit via a backend (e.g., Cloudflare Worker)
    const handlePublishToRedditBackend = async () => {
        if (!currentArticleDraft) {
            alert("Please generate an article draft first.");
            return;
        }

        setLoading(true);
        try {
            const cleanedContent = cleanArticleContent(currentArticleDraft.content);
            const response = await fetch('https://reddit-api-worker.growmybisznow.workers.dev/publish-reddit', { // YOUR ACTUAL WORKER URL
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    // You might need to send an authorization token here if your Worker requires it
                },
                body: JSON.stringify({
                    title: currentArticleDraft.title,
                    flair: currentArticleDraft.flair, // You might need to map this to a Flair ID in your Worker
                    content: cleanedContent,
                    subreddit: 'growmybusinessnow' // Your subreddit name
                })
            });

            if (response.ok) {
                const result = await response.json();
                alert(`Article successfully sent to backend for Reddit publishing! Status: ${result.status || 'Success'}`);
                // Optionally, save to app history after successful backend call
                publishArticle(); // This will save to Firestore history
            } else {
                const errorData = await response.json();
                alert(`Failed to send article to backend for Reddit publishing: ${errorData.message || response.statusText}`);
            }
        } catch (err) {
            console.error("Error publishing to Reddit via backend:", err);
            alert(`An error occurred while trying to publish to Reddit: ${err.message}`);
        } finally {
            setLoading(false);
        }
    };


    if (loading && !userId) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-100 p-4">
                <div className="bg-white p-6 rounded-lg shadow-md text-center">
                    <p className="text-lg font-semibold text-gray-700">Loading application and authenticating...</p>
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
                    User ID: <span className="font-mono text-gray-700 break-all">{userId}</span>
                </div>
            </header>

            <main className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Suggested Ideas Panel */}
                <section className="lg:col-span-1 bg-white p-6 rounded-lg shadow-md flex flex-col">
                    <h2 className="text-xl font-semibold text-gray-700 mb-4">Suggested Ideas</h2>
                    <button
                        onClick={generateIdeas}
                        className="bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded-lg shadow-md transition duration-300 ease-in-out mb-4 w-full"
                        disabled={loading}
                    >
                        {loading ? 'Generating...' : 'Generate New Ideas'}
                    </button>

                    {suggestedIdeas.length === 0 && !loading && (
                        <p className="text-gray-500 text-center mt-4">Click "Generate New Ideas" to get started.</p>
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
                                        {loading ? 'Generating...' : 'Approve & Generate Draft'}
                                    </button>
                                    <button
                                        onClick={() => rejectIdea(idea.id)}
                                        className="bg-red-500 hover:bg-red-600 text-white text-sm py-2 px-3 rounded-md transition duration-300"
                                        disabled={loading}
                                    >
                                        Reject
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                </section>

                {/* Article Draft Panel */}
                <section className="lg:col-span-2 bg-white p-6 rounded-lg shadow-md flex flex-col">
                    <h2 className="text-xl font-semibold text-gray-700 mb-4">Article Draft</h2>
                    {loading && (
                        <div className="text-center py-8">
                            <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-green-500 mx-auto"></div>
                            <p className="mt-4 text-gray-600">Generating draft, please wait...</p>
                        </div>
                    )}
                    {currentArticleDraft ? (
                        <div className="flex-grow flex flex-col">
                            <h3 className="text-2xl font-bold text-gray-900 mb-2">{currentArticleDraft.title}</h3>
                            <span className="text-md text-green-600 font-semibold mb-4">{currentArticleDraft.flair}</span>
                            <div className="bg-gray-50 p-4 rounded-lg border border-gray-200 flex-grow overflow-y-auto max-h-[500px] lg:max-h-[unset] prose prose-sm sm:prose lg:prose-lg">
                                {/* Using dangerouslySetInnerHTML to render Markdown */}
                                <div dangerouslySetInnerHTML={{ __html: currentArticleDraft.content.replace(/\n/g, '<br/>') }} />
                            </div>
                            <div className="mt-4 flex flex-col sm:flex-row space-y-3 sm:space-y-0 sm:space-x-3">
                                <button
                                    onClick={publishArticle}
                                    className="flex-1 bg-purple-600 hover:bg-purple-700 text-white font-bold py-2 px-4 rounded-lg shadow-md transition duration-300 ease-in-out"
                                    disabled={loading}
                                >
                                    Save to App History
                                </button>
                                <button
                                    onClick={() => copyToClipboard(cleanArticleContent(currentArticleDraft.content))}
                                    className="flex-1 bg-gray-200 hover:bg-gray-300 text-gray-800 font-bold py-2 px-4 rounded-lg shadow-md transition duration-300 ease-in-out"
                                >
                                    Copy Clean Content
                                </button>
                                <button
                                    onClick={handleExportToSheet} // New button for Google Sheet export
                                    className="flex-1 bg-orange-500 hover:bg-orange-600 text-white font-bold py-2 px-4 rounded-lg shadow-md transition duration-300 ease-in-out"
                                    disabled={loading}
                                >
                                    Export to Google Sheet (Copy Data)
                                </button>
                                <button
                                    onClick={handlePublishToRedditBackend} // New button for direct Reddit publishing via backend
                                    className="flex-1 bg-red-700 hover:bg-red-800 text-white font-bold py-2 px-4 rounded-lg shadow-md transition duration-300 ease-in-out"
                                    disabled={loading}
                                >
                                    Publish to Reddit (via Backend)
                                </button>
                                <button
                                    onClick={() => setCurrentArticleDraft(null)}
                                    className="flex-1 bg-red-500 hover:bg-red-600 text-white font-bold py-2 px-4 rounded-lg shadow-md transition duration-300 ease-in-out"
                                >
                                    Discard Draft
                                </button>
                            </div>
                        </div>
                    ) : (
                        <p className="text-gray-500 text-center mt-8">
                            Select an idea to generate an article draft here.
                        </p>
                    )}
                </section>

                {/* Published Articles History */}
                <section className="lg:col-span-3 bg-white p-6 rounded-lg shadow-md mt-6">
                    <h2 className="text-xl font-semibold text-gray-700 mb-4">My Published Articles</h2>
                    {articles.length === 0 && !loading && (
                        <p className="text-gray-500 text-center">No articles published yet.</p>
                    )}
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {articles.map((article) => (
                            <div key={article.id} className="p-4 border border-gray-200 rounded-lg bg-gray-50">
                                <h3 className="text-lg font-medium text-gray-800">{article.title}</h3>
                                <span className="text-sm text-green-600 font-semibold">{article.flair}</span>
                                <p className="text-xs text-gray-500 mt-1">
                                    Published: {new Date(article.publishedAt?.toDate()).toLocaleDateString()}
                                </p>
                                <button
                                    onClick={() => setViewingArticle(article)}
                                    className="mt-3 bg-blue-500 hover:bg-blue-600 text-white text-sm py-1.5 px-3 rounded-md transition duration-300 w-full"
                                >
                                    View Article
                                </button>
                            </div>
                        ))}
                    </div>

                    {/* Modal to view full article */}
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
                                    {/* Using dangerouslySetInnerHTML to render Markdown */}
                                    <div dangerouslySetInnerHTML={{ __html: viewingArticle.content.replace(/\n/g, '<br/>') }} />
                                </div>
                                <button
                                    onClick={() => copyToClipboard(cleanArticleContent(viewingArticle.content))}
                                    className="mt-6 bg-gray-200 hover:bg-gray-300 text-gray-800 font-bold py-2 px-4 rounded-lg shadow-md transition duration-300 ease-in-out w-full"
                                >
                                    Copy Clean Content
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
