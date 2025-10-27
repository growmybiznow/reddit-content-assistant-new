// scripts/automate.js
import fetch from 'node-fetch';
import { callGeminiAPI, fetchRedditTrends, publishToReddit } from '../src/api.js';

// Polyfill fetch for Node.js environment
global.fetch = fetch;

const SUBREDDIT = 'growmybusinessnow';

const flairs = [
    "🚀 Growth Hacks & Breakthroughs",
    "💡 Freebie Fortune Finders",
    "📈 Digital Domination Playbook",
    "💸 Profit Pathways & Funding Funnel"
];

async function automateContentCreation() {
    console.log(`Starting content automation for r/${SUBREDDIT}...`);

    try {
        // 1. Fetch Reddit Trends
        console.log('Fetching Reddit trends...');
        const trends = await fetchRedditTrends(SUBREDDIT);
        if (!trends || trends.length === 0) {
            console.log('No trends found. Exiting.');
            return;
        }
        console.log(`Found ${trends.length} trending posts.`);

        // 2. Generate a new idea based on trends
        console.log('Generating a new article idea...');
        const trendingTitles = trends.map(post => `- "${post.title}"`).join('\n');
        const ideaPrompt = `You are an expert content strategist for the Reddit community r/${SUBREDDIT}.

Based on the following list of currently popular post titles from the community:
${trendingTitles}

Generate 1 new, attractive, and valuable article title idea that captures a similar style or address related topics. The goal is to create content that will resonate strongly with the community. Focus on practical, actionable strategies for small businesses in the USA, using free or low-cost resources.

Assign the new idea to one of the following flairs:
- 🚀 Growth Hacks & Breakthroughs
- 💡 Freebie Fortune Finders
- 📈 Digital Domination Playbook
- 💸 Profit Pathways & Funding Funnel

Output format JSON:
{ "title": "New Idea Title", "flair": "Corresponding Flair" }`;

        const ideaSchema = {
            type: "OBJECT",
            properties: {
                "title": { "type": "STRING" },
                "flair": { "type": "STRING" }
            },
            "propertyOrdering": ["title", "flair"]
        };

        const idea = await callGeminiAPI(ideaPrompt, true, ideaSchema);
        if (!idea || !idea.title) {
            throw new Error('Failed to generate a valid idea.');
        }
        console.log(`Generated idea: "${idea.title}"`);

        // 3. Generate the full article draft
        console.log('Generating the full article...');
        const articlePrompt = `Write a detailed and valuable article in ENGLISH for the Reddit community r/${SUBREDDIT}, with the title "**${idea.title}**" and under the flair "${idea.flair}".
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
        const articleContent = await callGeminiAPI(articlePrompt);
        if (!articleContent) {
            throw new Error('Failed to generate article content.');
        }
        console.log('Article content generated successfully.');

        // 4. Publish to Reddit
        console.log('Publishing article to Reddit...');
        const publishData = {
            title: idea.title,
            flair: idea.flair,
            content: articleContent,
            subreddit: SUBREDDIT,
            clientSecret: process.env.REDDIT_CLIENT_SECRET
        };

        const result = await publishToReddit(publishData);
        console.log('Successfully published to Reddit:', result);

    } catch (error) {
        console.error('Automation script failed:', error);
        process.exit(1); // Exit with error code
    }
}

automateContentCreation();
