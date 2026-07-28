export type ChatMessage = {
  /** Display name as it appeared in the screenshot, or "Me" / "Them" when unlabeled. */
  sender: string;
  text: string;
  /** Timestamp string exactly as shown in the screenshot, if one was visible. */
  time?: string;
};

export type ExtractedBatch = {
  messages: ChatMessage[];
};

/**
 * The distilled writing style of one participant. This is what makes replies
 * sound like them — it is injected into the chat system prompt on every turn.
 */
export type StyleProfile = {
  displayName: string;
  /** Prose summary of how this person writes. */
  voice: string;
  /** Words and phrases they reach for repeatedly. */
  signaturePhrases: string[];
  /** Greetings/sign-offs they actually used. */
  openers: string[];
  closers: string[];
  /** Emoji they use, most frequent first. Empty if they don't use emoji. */
  emoji: string[];
  /** e.g. "lowercase, rarely punctuates, uses '...' a lot" */
  punctuation: string;
  /** e.g. "usually 3-8 words, occasionally a long burst of several messages" */
  messageLength: string;
  /** Subjects they return to. */
  topics: string[];
  /** Anything else distinctive: humour, tics, how they argue, how they show affection. */
  quirks: string[];
  /** Verbatim lines that best show the voice. Used as few-shot examples. */
  exemplars: string[];
};

export type Persona = {
  profile: StyleProfile;
  /** Every extracted message, kept for excerpt retrieval during chat. */
  transcript: ChatMessage[];
  /** All sender names seen, so the UI can offer the choice. */
  participants: string[];
  createdAt: number;
};

export type Turn = {
  role: 'user' | 'assistant';
  content: string;
};
