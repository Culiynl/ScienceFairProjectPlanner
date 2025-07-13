/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GoogleGenAI, Type, Chat, GenerateContentResponse } from "@google/genai";
import { marked, Tokens } from "marked";

const app = document.getElementById("app") as HTMLDivElement;
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

// --- CONFIGURE MARKED ---
// Override the default link renderer to open links in a new tab.
// The type definitions for `marked.use()` expect a token-based renderer,
// which takes a single `token` object as an argument. The previous
// implementation used an outdated signature. This new implementation
// correctly uses the token object to construct the link.
marked.use({
  renderer: {
    link: (token: Tokens.Link): string => {
      const titleAttr = token.title ? ` title="${token.title}"` : '';
      // `marked.parseInline` is used to render any markdown within the link text itself (e.g., bold or italics).
      const text = marked.parseInline(token.text);
      return `<a href="${token.href}"${titleAttr} target="_blank" rel="noopener noreferrer">${text}</a>`;
    },
  },
});


type View = "welcome" | "results" | "project";

interface ProjectIdea {
  title: string;
  description: string;
  analysis: string; // Markdown table
  category: string;
  impact: number;
  rigor: number;
  novelty: number;
  wowFactor: number;
  resourcesHtml: string;
}

interface AppState {
  view: View;
  isLoading: boolean;
  error: string | null;
  topic: string;
  subtopics: string;
  fieldAnalysis: string;
  projects: ProjectIdea[];
  sources: { uri: string; title: string }[];
  selectedProject: ProjectIdea | null;
  timeline: any | null; // From JSON schema
  chat: Chat | null;
  chatHistory: { role: "user" | "model"; content: string }[];
}

let state: AppState = {
  view: "welcome",
  isLoading: false,
  error: null,
  topic: "",
  subtopics: "",
  fieldAnalysis: "",
  projects: [],
  sources: [],
  selectedProject: null,
  timeline: null,
  chat: null,
  chatHistory: [],
};

// --- ICONS ---
const ICON_BACK_ARROW = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M11.8284 12.0007L16.7782 16.9504L15.364 18.3646L9 12.0007L15.364 5.63672L16.7782 7.05093L11.8284 12.0007Z"></path></svg>`;
const ICON_SEND = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="24" height="24"><path d="M3.47827 20.5217L21.0001 12L3.47827 3.47827L3.47826 10L15.0001 12L3.47826 14L3.47827 20.5217Z"></path></svg>`;
const ICON_SAVE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M13 10H18L12 16L6 10H11V3H13V10ZM4 18H20V20H4V18Z"></path></svg>`

function setState(newState: Partial<AppState>) {
  state = { ...state, ...newState };
  render();
}

function renderLoading() {
  return `<div class="loader-container"><div class="loader"></div></div>`;
}

function renderError() {
  if (!state.error) return "";
  return `<div class="error-message" role="alert"><strong>Error:</strong> ${state.error}</div>`;
}

// ---- WELCOME VIEW ----
function renderWelcome() {
  app.innerHTML = `
    <div class="app-container">
      <div class="welcome-container">
        <div class="welcome-content-wrapper">
          <header>
            <img src="FIRI_logo.png" alt="FIRI Logo" class="welcome-logo" />
            <p class="caption">Built for research</p>
          </header>
          <main>
            <form id="topic-form">
              <label for="topic-input" class="sr-only">Enter your topic</label>
              <input type="text" id="topic-input" name="topic" placeholder="Topic (e.g. physics, chemistry, biology)" required />
              <button type="submit">Brainstorm Projects</button>
            </form>
             <div class="divider">or</div>
            <button type="button" id="load-btn" class="secondary-button">Load Saved Projects</button>
            <input type="file" id="load-input" class="sr-only" accept=".json,.txt">

            ${state.isLoading ? renderLoading() : ""}
            ${renderError()}
          </main>
        </div>
      </div>
    </div>
  `;
  document.getElementById("topic-form")?.addEventListener("submit", handleTopicSubmit);
  document.getElementById("load-btn")?.addEventListener("click", () => {
    document.getElementById("load-input")?.click();
  });
  document.getElementById("load-input")?.addEventListener("change", handleLoadFile);
}


// ---- RESULTS VIEW ----
async function renderResults() {
  const projectsHtml = await Promise.all(
    state.projects.map(async (project) => `
      <div class="project-card">
        <h3>${project.title}</h3>
        <p class="project-category">${project.category}</p>
        <div class="project-description">${await marked.parse(project.description)}</div>
        <h4>Feasibility & Limitations</h4>
        <div class="table-container">${await marked.parse(project.analysis)}</div>
        <div class="rankings-container">
          <h4>Rankings (1-10)</h4>
          <div class="ranking-grid">
            <div class="ranking-item">
              <span class="ranking-label">Impact</span>
              <span class="ranking-score">${project.impact}</span>
            </div>
            <div class="ranking-item">
              <span class="ranking-label">Scientific Rigor</span>
              <span class="ranking-score">${project.rigor}</span>
            </div>
            <div class="ranking-item">
              <span class="ranking-label">Novelty</span>
              <span class="ranking-score">${project.novelty}</span>
            </div>
            <div class="ranking-item">
              <span class="ranking-label">Wow Factor</span>
              <span class="ranking-score">${project.wowFactor}</span>
            </div>
          </div>
        </div>
        <h4>Key Resources</h4>
        <div class="resources-list">${await marked.parse(project.resourcesHtml)}</div>
        <button class="select-project-btn" data-title="${project.title}">Select this Project</button>
      </div>
    `)
  );

  const sourcesHtml = state.sources.length > 0
    ? `<h3>Sources</h3><ul class="sources-list">${state.sources
        .map(
          (source) =>
            `<li><a href="${source.uri}" target="_blank" rel="noopener noreferrer">${source.title || source.uri}</a></li>`
        )
        .join("")}</ul>`
    : "";
    
  const fieldAnalysisHtml = state.fieldAnalysis ? `
    <div class="results-section analysis-section">
      <h2>State of the Field Analysis</h2>
      <div id="field-analysis-content">${await marked.parse(state.fieldAnalysis)}</div>
    </div>
  ` : "";

  app.innerHTML = `
    <div class="app-container">
      <nav class="top-nav">
        <button id="back-to-welcome" class="nav-button">${ICON_BACK_ARROW} Start Over</button>
        <button id="save-projects-btn" class="nav-button">${ICON_SAVE} Save Projects</button>
      </nav>
      <header>
        <h1>Ideas for: ${state.topic}</h1>
      </header>
      <main>
        ${state.isLoading ? renderLoading() : ""}
        ${renderError()}
        <section id="results-content" ${state.isLoading ? 'style="display:none;"' : ""}>
          ${fieldAnalysisHtml}
          <div class="results-section">
            <h2>Subtopics</h2>
            <div id="subtopics-content">${await marked.parse(state.subtopics)}</div>
          </div>
          <div class="results-section">
            <h2>Project Ideas</h2>
            <div class="project-grid">${projectsHtml.join("")}</div>
          </div>
          <div class="results-section" id="sources-section">
            ${sourcesHtml}
          </div>
        </section>
      </main>
    </div>
  `;

  document.getElementById("back-to-welcome")?.addEventListener("click", () => setState({ view: "welcome" }));
  document.getElementById("save-projects-btn")?.addEventListener("click", handleSaveProjects);
  document.querySelectorAll(".select-project-btn").forEach((button) => {
    button.addEventListener("click", (e) => {
      const title = (e.target as HTMLElement).dataset.title;
      const project = state.projects.find(p => p.title === title);
      if (project) {
        handleProjectSelect(project);
      }
    });
  });
}

// ---- PROJECT VIEW ----
async function renderProject() {
  if (!state.selectedProject) return;

  const timelineHtml = state.timeline ? `
    <div class="timeline">
      ${state.timeline.timeline.map((phase: any) => `
        <div class="timeline-phase">
          <h4>${phase.phase} (~${phase.duration})</h4>
          <ul>
            ${phase.tasks.map((task: string) => `<li>${task}</li>`).join("")}
          </ul>
        </div>
      `).join("")}
    </div>
  ` : "";

  const chatHistoryHtml = await Promise.all(state.chatHistory.map(async (msg) =>
    `<div class="chat-message ${msg.role}">${await marked.parse(msg.content)}</div>`
  ));

  app.innerHTML = `
   <div class="app-container">
      <nav class="top-nav">
        <button id="back-to-results" class="nav-button">${ICON_BACK_ARROW} Back to Ideas</button>
      </nav>
      <header>
        <h1>${state.selectedProject.title}</h1>
      </header>
      <main class="project-view-main">
        <div class="project-details-column">
          <h2>Project Plan</h2>
          <div class="project-description">${await marked.parse(state.selectedProject.description)}</div>
          <h3>Proposed Timeline</h3>
          ${state.isLoading && !state.timeline ? renderLoading() : timelineHtml}
        </div>
        <div class="chat-column">
          <h2>Ask Questions</h2>
          <div id="chat-container" aria-live="polite">
            ${chatHistoryHtml.join("")}
            ${state.isLoading && state.timeline ? renderLoading() : ""}
          </div>
          <form id="chat-form">
            <label for="chat-input" class="sr-only">Ask a question about the project</label>
            <input type="text" id="chat-input" placeholder="e.g., 'How can I collect the data?'" required />
            <button type="submit" aria-label="Ask question">${ICON_SEND}</button>
          </form>
        </div>
      </main>
    </div>
  `;
  document.getElementById("back-to-results")?.addEventListener("click", () =>
    setState({
      view: "results",
      selectedProject: null,
      timeline: null,
      chat: null,
      chatHistory: [],
    })
  );
  document.getElementById("chat-form")?.addEventListener("submit", handleChatSubmit);
  const chatContainer = document.getElementById("chat-container");
  if(chatContainer) {
    chatContainer.scrollTop = chatContainer.scrollHeight;
  }
}

// ---- EVENT HANDLERS & API CALLS ----

function handleSaveProjects() {
  const dataToSave = {
    topic: state.topic,
    subtopics: state.subtopics,
    projects: state.projects,
    sources: state.sources,
    fieldAnalysis: state.fieldAnalysis,
  };
  const blob = new Blob([JSON.stringify(dataToSave, null, 2)], {type: "application/json"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `firi-projects-${state.topic.toLowerCase().replace(/\s/g, '-')}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function handleLoadFile(event: Event) {
  const input = event.target as HTMLInputElement;
  if (!input.files || input.files.length === 0) return;
  
  const file = input.files[0];
  const reader = new FileReader();
  
  reader.onload = (e) => {
    try {
      const result = e.target?.result as string;
      const data = JSON.parse(result);
      
      // Validate the loaded data
      if (data.topic && data.subtopics && Array.isArray(data.projects)) {
        setState({
          view: 'results',
          topic: data.topic,
          subtopics: data.subtopics,
          projects: data.projects,
          sources: data.sources || [],
          fieldAnalysis: data.fieldAnalysis || "",
          error: null,
          isLoading: false
        });
      } else {
        throw new Error("Invalid or corrupted project file.");
      }
    } catch (err) {
      console.error("Failed to load or parse file:", err);
      setState({ error: (err as Error).message, view: 'welcome', isLoading: false });
    }
  };
  
  reader.onerror = () => {
     setState({ error: 'Failed to read the selected file.', view: 'welcome', isLoading: false });
  };
  
  reader.readAsText(file);
}


async function handleTopicSubmit(event: Event) {
  event.preventDefault();
  const form = event.target as HTMLFormElement;
  const formData = new FormData(form);
  const topic = formData.get("topic") as string;

  setState({ isLoading: true, error: null, topic });

  const prompt = `
You are an expert science fair strategist helping a student brainstorm a project about "${topic}".

Your main tasks are:
1.  **State of the Field Analysis:** Use Google Search to provide a brief but insightful analysis of the current state of the field for "${topic}". What are the current major trends, challenges, and exciting areas of research? This should be a high-level overview to orient the student.

2.  **Suggest Subtopics:** Based on your analysis and the user's topic ("${topic}"), list 3-5 relevant subtopics.

3.  **Generate Project Ideas:** Propose 5-7 distinct project ideas. These ideas should be novel, useful, and aligned with an official ISEF category. Crucially, if a project idea is inspired by or directly related to a past ISEF Grand Award-winning project found via Google Search, you MUST explicitly mention it in the description to provide context. For example: "This concept builds upon the work of a 2023 Grand Award project, which successfully used [...], and aims to improve upon it by [...]."

**Official ISEF Categories:** Animal Sciences (AS), Behavioral and Social Sciences (BE), Biochemistry (BI), Biomedical and Health Sciences (BM), Biomedical Engineering (EN), Cellular and Molecular Biology (CB), Chemistry (CH), Computational Biology and Bioinformatics (CO), Earth and Environmental Sciences (EA), Embedded Systems (EB), Energy: Sustainable Materials and Design (EG), Engineering Technology: Statics and Dynamics (ET), Environmental Engineering (EE), Materials Science (MS), Mathematics (MA), Microbiology (MI), Physics and Astronomy (PA), Plant Sciences (PS), Robotics and Intelligent Machines (RO), Systems Software (SS), Translational Medical Science (TM).

For each project idea, provide:
a. A clear title.
b. The most relevant ISEF Category.
c. A one-paragraph description focusing on its novelty and real-world impact. In this description, identify key technical terms, concepts, or required skills and hyperlink them in markdown format to relevant explanatory web pages (e.g., Wikipedia, tutorials, documentation). This is also where you should mention any inspiration from past ISEF winners.
d. A "Feasibility & Limitations" analysis in a markdown table.
e. A ranking on a scale of 1-10 for various criteria in a markdown table.
f. A list of 2-3 "Key Resources" (like seminal papers or core documentation) as a markdown list of links.

Your response MUST follow this exact markdown structure, with "---" as a separator between each major section:

### State of the Field Analysis
*(Your analysis of the current research landscape for the topic goes here. For example: "The field of computational biology is currently dominated by the application of deep learning to... Key challenges include data availability and model interpretability...")*

---

### Subtopics
- Subtopic 1
- Sub-topic 2

---

### Project Idea 1
**Title:** [Project 1 Title]
**ISEF Category:** [ISEF Category Name (CODE)]
**Description:** This project involves using a [Generative Adversarial Network (GAN)](https://en.wikipedia.org/wiki/Generative_adversarial_network) to create novel protein structures. This requires knowledge of [PyTorch](https://pytorch.org/tutorials/) and [bioinformatics](https://en.wikipedia.org/wiki/Bioinformatics). This approach is inspired by the increasing use of AI in drug discovery, similar to themes seen in recent ISEF-winning computational biology projects.
**Feasibility & Limitations:**
| Aspect | Analysis |
| :--- | :--- |
| Data Availability | [Analysis] |
| Technical Complexity | [Analysis] |
| Time Commitment | [Analysis] |
**Rankings:**
| Criteria | Score (1-10) |
| :--- | :--- |
| Impact | [Score] |
| Scientific Rigor | [Score] |
| Novelty | [Score] |
| Wow Factor | [Score] |
**Key Resources:**
- [Goodfellow, I., et al. (2014). Generative Adversarial Nets.](https://arxiv.org/abs/1406.2661)
- [DeepMind's AlphaFold](https://www.deepmind.com/research/highlighted-research/alphafold)

---

### Project Idea 2
... and so on for all 5-7 projects.

Use Google Search extensively to find up-to-date, cutting-edge information to ensure your suggestions and analysis are well-grounded and truly innovative.`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }],
      },
    });

    const text = response.text;
    const parts = text.split("\n---\n");
    const fieldAnalysis = parts[0] || "";
    const subtopics = parts[1] || "";
    const projects = parts.slice(2).map(part => {
      const titleMatch = part.match(/\*\*Title:\*\*\s*(.*)/);
      const categoryMatch = part.match(/\*\*ISEF Category:\*\*\s*(.*)/);
      const descMatch = part.match(/\*\*Description:\*\*\s*([\s\S]*?)(?=\n\*\*Feasibility & Limitations:\*\*)/);
      const analysisMatch = part.match(/\*\*Feasibility & Limitations:\*\*\s*([\s\S]*?)(?=\n\*\*Rankings:\*\*)/);
      const rankingsMatch = part.match(/\*\*Rankings:\*\*\s*([\s\S]*?)(?=\n\*\*Key Resources:\*\*)/);
      const resourcesMatch = part.match(/\*\*Key Resources:\*\*\s*([\s\S]*)/);
      
      let impact = 0, rigor = 0, novelty = 0, wowFactor = 0;

      if (rankingsMatch && rankingsMatch[1]) {
        const rankingsTable = rankingsMatch[1].trim();
        const impactMatch = rankingsTable.match(/\| Impact\s*\|\s*(\d{1,2})\s*\|/);
        const rigorMatch = rankingsTable.match(/\| Scientific Rigor\s*\|\s*(\d{1,2})\s*\|/);
        const noveltyMatch = rankingsTable.match(/\| Novelty\s*\|\s*(\d{1,2})\s*\|/);
        const wowFactorMatch = rankingsTable.match(/\| Wow Factor\s*\|\s*(\d{1,2})\s*\|/);

        impact = impactMatch ? parseInt(impactMatch[1], 10) : 0;
        rigor = rigorMatch ? parseInt(rigorMatch[1], 10) : 0;
        novelty = noveltyMatch ? parseInt(noveltyMatch[1], 10) : 0;
        wowFactor = wowFactorMatch ? parseInt(wowFactorMatch[1], 10) : 0;
      }

      return {
        title: titleMatch ? titleMatch[1].trim() : "Untitled",
        category: categoryMatch ? categoryMatch[1].trim() : "N/A",
        description: descMatch ? descMatch[1].trim() : "No description.",
        analysis: analysisMatch ? analysisMatch[1].trim() : "No analysis.",
        impact,
        rigor,
        novelty,
        wowFactor,
        resourcesHtml: resourcesMatch ? resourcesMatch[1].trim() : "",
      };
    }).filter(p => p.title !== 'Untitled'); // Filter out any empty trailing parts

    const groundingMetadata = response.candidates?.[0]?.groundingMetadata;
    const sources = groundingMetadata?.groundingChunks
      ?.map(c => c.web)
      .filter(w => w?.uri) as { uri: string, title: string }[] || [];
    
    // Remove duplicates
    const uniqueSources = Array.from(new Map(sources.map(s => [s.uri, s])).values());

    setState({
      view: "results",
      isLoading: false,
      fieldAnalysis,
      subtopics,
      projects,
      sources: uniqueSources,
    });
  } catch (err) {
    console.error(err);
    setState({ isLoading: false, error: (err as Error).message, view: 'welcome' });
  }
}

async function handleProjectSelect(project: ProjectIdea) {
  setState({
    view: "project",
    isLoading: true,
    error: null,
    selectedProject: project,
    timeline: null,
    chat: null,
    chatHistory: [],
  });

  try {
    const chat = ai.chats.create({
      model: "gemini-2.5-flash",
      config: {
        systemInstruction: `You are a helpful science fair project advisor. You are answering questions about the following project.
        Project Title: "${project.title}"
        Project Description: "${project.description}"
        Keep your answers concise and helpful for a student. Be encouraging and supportive.`,
      },
    });

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: `Create a detailed, step-by-step project timeline for a science fair project titled "${project.title}".
      The timeline should be broken down into logical phases (like 'Research', 'Data Collection', 'Development', 'Analysis', 'Final Presentation').
      For each phase, list the key tasks and provide an estimated duration.`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            timeline: {
              type: Type.ARRAY,
              description: "A list of steps for the project timeline.",
              items: {
                type: Type.OBJECT,
                properties: {
                  phase: { type: Type.STRING, description: "Name of the project phase (e.g., Data Collection)." },
                  tasks: { type: Type.ARRAY, items: { type: Type.STRING } },
                  duration: { type: Type.STRING, description: "Estimated duration (e.g., 1-2 weeks)." }
                },
                required: ["phase", "tasks", "duration"]
              }
            }
          }
        },
      },
    });
    
    const timeline = JSON.parse(response.text);

    const initialGreeting = `Hello! I'm here to help you with your project, **"${project.title}"**. I've generated a potential timeline for you. What's your first question?`;
    
    setState({
      isLoading: false,
      timeline,
      chat,
      chatHistory: [{ role: "model", content: initialGreeting }],
    });

  } catch (err) {
    console.error(err);
    setState({
      isLoading: false,
      error: `Failed to generate timeline. ${(err as Error).message}`,
      view: 'results' // Go back if it fails
    });
  }
}

async function handleChatSubmit(event: Event) {
  event.preventDefault();
  const form = event.target as HTMLFormElement;
  const input = form.querySelector("#chat-input") as HTMLInputElement;
  const message = input.value;
  if (!message || !state.chat) return;
  input.value = "";

  setState({
    isLoading: true,
    chatHistory: [...state.chatHistory, { role: "user", content: message }],
  });
  
  // Add an empty model message to stream into
  setState({
    chatHistory: [...state.chatHistory, { role: "model", content: "" }]
  });

  try {
    const stream = await state.chat.sendMessageStream({ message });
    let fullResponse = "";
    for await (const chunk of stream) {
      fullResponse += chunk.text;
      const lastMessageIndex = state.chatHistory.length - 1;
      const updatedHistory = [...state.chatHistory];
      updatedHistory[lastMessageIndex] = { role: "model", content: fullResponse };
      setState({ chatHistory: updatedHistory }); // Re-render on each chunk
    }
  } catch (err) {
    console.error(err);
    const lastMessageIndex = state.chatHistory.length - 1;
    const updatedHistory = [...state.chatHistory];
    updatedHistory[lastMessageIndex] = { role: "model", content: `Sorry, I encountered an error: ${(err as Error).message}` };
    setState({ chatHistory: updatedHistory });
  } finally {
    setState({ isLoading: false });
  }
}


// ---- MAIN RENDER FUNCTION ----
function render() {
  switch (state.view) {
    case "welcome":
      renderWelcome();
      break;
    case "results":
      renderResults();
      break;
    case "project":
      renderProject();
      break;
  }
}

// Initial render
render();
