# Tech Brief: Prototype Plan

**Project:** Digital afterlife platform (recreating a deceased person from their digital footprint into an interactive experience) **Prepared by:** Diego (technical) **Covers:** Tool stack, process to prototype, what the prototype is, timeline **Status:** For discussion, Saturday call

---

## 1\. What we're building for the prototype (and what we're not)

The prototype is a **web app** with real accounts and a full creation flow, working end to end for **one avatar per user**. It has two halves:

**A. Setup: create the avatar (the deceased loved one)**

1. **Account and login.** Users sign up and log in. Their avatars and data are private to their account.  
2. **Create avatar.** The user enters the deceased person's basic data (name, relationship, key details) to start building them.  
3. **Voice upload with age.** The user uploads the person's voice recording and enters the **age** at which that voice was recorded, so the clone reflects a specific point in their life.  
4. **Personality capture.** A dedicated flow that reveals who the person was. Two input paths, usable together:  
   - a **guided questionnaire** (how they talked, their quirks, phrases, temperament, MBTI, key relationships and memories), and  
   - a **file upload** of samples of their writing and messages in plain text (saved texts, letters, notes, or transcripts), which the system analyzes to extract tone, phrasing, recurring topics, and quirks.

**B. Conversation: talk to them**

5. **Text chat.** You text them directly on the platform and they reply in their own words, phrasing, and topics.  
6. **Cloned voice.** Replies play back in a clone of their real voice.  
7. **Two-way voice.** You can **speak to them in your own voice** and hear their cloned voice reply. A spoken conversation, not just typing.

**Explicitly NOT in the prototype.** These are the real product vision, but they are months of work, not weeks:

- Talking-head avatar (face that speaks)  
- Automatic age detection across many files (timeline engine). For the prototype, the user simply enters the age on the upload form.  
- Holograms  
- Full-body motion and gestures  
- Real-time 3D avatars (Unreal or Unity MetaHuman)  
- AR glasses, VR, metaverse delivery

The prototype's job is to prove the **hard, differentiating part**: that a user can, from footprint alone, reconstruct a *deceased* person, their voice and personality, and hold a real spoken conversation that feels like *them*. The face, ages, motion, and hologram are layers we add on top later.

---

## 2\. Tool stack

The strategy is to **wire together hosted AI services** rather than train models ourselves. This plays to my actual strengths (web and mobile full-stack plus API integration) and keeps the small-team, fast-MVP principle intact.

| Layer | Tool | Why |
| :---- | :---- | :---- |
| **Frontend(9)** | Next.js (React, TypeScript) | Web app, creation flow and chat UI, my core stack |
| **Auth(9)** | NextAuth | User sign-up and login, private per-account data |
| **Database(8)** | Managed Postgres (Neon or Railway) with pgvector | One database for user accounts, avatar profiles, and the memory embeddings. No separate vector service needed. |
| **Backend / orchestration(9)** | Node.js (Fastify), containerized, on AWS ECS Fargate | Fast framework, persistent server, auto-scales, ready for real-time voice later |
| **Conversation brain(8)** | OpenAI GPT API (GPT-4o) | Drives the personality and dialogue |
| **Memory / real phrasing (RAG)(8)** | OpenAI embeddings, stored in pgvector | Stores the uploaded texts so replies pull their *actual* words, stories, and quirks |
| **Personality analysis(8)** | OpenAI GPT API | Reads the uploaded chats and builds the persona profile |
| **Speech-to-text (your voice in)(8)** | OpenAI Whisper | Turns your spoken words into text so you can talk to them, not just type |
| **Voice clone (their voice out)(9)** | ElevenLabs | The one piece OpenAI cannot do. Clones the real voice from the uploaded sample. |
| **File uploads and storage(9)** | Amazon S3 | Uploaded voice recordings and chat or text exports |
| **Hosting(9)** | Frontend on Vercel (or AWS Amplify), backend on AWS ECS Fargate behind an ALB, files on S3 | Persistent Node server on AWS, auto-scaling, WebSocket-ready |

**Note on the backend.** We run a persistent Node server (Fastify) in a container on AWS ECS Fargate rather than serverless functions. This keeps the backend fast for the prototype's request-and-response flow (upload voice, transcribe, get a GPT reply, return the cloned-voice audio) and, importantly, means the *same* backend handles true real-time streaming voice later (interrupting mid-sentence, sub-second latency, WebSockets) without a rewrite. Fargate auto-scales and needs no server management. For the quickest possible start we can run the identical app on a single EC2 box with PM2 and Nginx, then move to Fargate when we need to scale.

**Note on the personality engine.** The personality-capture inputs (questionnaire answers plus uploaded chats) become a structured **persona profile** that drives the model's system prompt, combined with RAG over the uploaded messages. MBTI is treated as a *seed input to the profile*, not separate tech, so no extra build cost.

---

## 3\. Process to prototype

**Step 1\. Accounts and auth.** Build sign-up and login with NextAuth. Each user's avatars and uploads are private to their account.

**Step 2\. Create-avatar flow.** A form where the user enters the deceased person's basic data (name, relationship, details) and starts a new avatar record.

**Step 3\. Voice upload with age.** Upload the person's voice recording to S3 and enter the age for that voice. Store the file reference and the age against the avatar.

**Step 4\. Personality capture.** The guided questionnaire plus the text file upload. Use GPT to parse the uploads for tone, topics, phrasing, and quirks, and combine with the questionnaire answers. Output: a structured persona profile plus memory loaded into pgvector.

**Step 5\. Voice clone.** Create the voice clone in ElevenLabs from the uploaded sample. Output: their voice, on demand.

**Step 6\. Conversation layer.** Wire it together: your message (typed or spoken) goes to GPT with the persona profile and memory, returns a text reply, then plays in the ElevenLabs cloned voice.

**Step 7\. Voice input.** Add Whisper speech-to-text so you can speak into the app in your own voice. Output: a full two-way spoken conversation.

**Step 8\. Interface.** Web app tying it together: create an avatar, then open it and **type or speak**, getting back text plus their cloned voice.

---

## 4\. What the prototype looks like

A private web app. The full user journey:

1. You **sign up and log in**.  
2. You **create an avatar** of your lost loved one and enter their basic details.  
3. You **upload their voice** and enter the age for that recording.  
4. You complete the **personality capture**: answer the guided questions and upload their chats or texts.  
5. You open the avatar and start a **conversation**. You **type or speak** in your own voice, and they reply in **their own words and topics**, in **their cloned voice**.

No face yet. This is a voice and text experience built on a real account and creation flow, so it already looks and feels like a product, not a script. That's enough to show an investor or partner the core magic, *"we brought back someone who was already gone,"* before we build the face and hologram.

**One thing I need from you to make this land:** the right character for the demo. We need someone with a **rich footprint**: lots of text messages and several clear voice recordings. A sparse footprint will produce a weak result no matter how good the tech is.

---

## 5\. Timeline

**Target: 3 weeks** for the full prototype above (auth, creation flow, personality capture, and the two-way voice conversation), using hosted APIs and my web stack.

| Week | Focus | Milestone |
| :---- | :---- | :---- |
| **Week 1** | Auth, accounts, database, create-avatar flow, voice upload with age, file uploads | You can sign up and create an avatar with voice and data stored |
| **Week 2** | Personality capture, persona construction, RAG, voice clone, text chat | You can chat with the avatar and it replies in their voice and character |
| **Week 3** | Voice input (two-way), interface polish, family-feedback tuning, demo prep | Demoable end-to-end prototype: create, then speak and be spoken back to |

**Honest read on the estimate:**

- **3 weeks** is realistic. The auth and creation flow are standard web work I move fast on. The persona and voice pieces are hosted-API integration. One character.  
- **Talking-head avatar plus age-accuracy** (added later): roughly plus 2 to 3 weeks when we want them.  
- **Motion, 3D, hologram, AR glasses:** months, separate phase, likely needs a dedicated AI or graphics hire and funding. Not prototype scope.  
- **The biggest risk to the timeline isn't code, it's data.** If we can't get enough good footprint on the chosen character, quality drops regardless of the stack.

---

## 6\. Open questions for Saturday

1. **Budget for API costs** during the build (OpenAI GPT and Whisper, ElevenLabs). Low hundreds of dollars for a prototype.  
2. **AWS account.** We need an AWS account set up to host the backend (Fargate or EC2) and the S3 storage. Who creates and owns it, and how is billing handled? Best under a company account from the start rather than a personal one.  
3. **Consent and legal:** who authorizes recreating this specific person's voice and likeness? Relevant even before we worry about US vs Japan market rules. (Voice cloning services require consent for the voice being cloned.)

---

## 7\. Bottom line

We can have a working single-character prototype with **real accounts, a create-your-avatar flow, voice upload, personality capture, and a two-way spoken conversation in the person's real voice and character**, in about **3 weeks**, using **GPT for the brain and ElevenLabs for the voice**, for a modest API budget. The face, ages, motion, and hologram are real, but they're later funded phases. The prototype proves the part nobody else is doing: bringing back someone who's *already gone*.  
