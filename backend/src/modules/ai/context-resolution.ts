import type {
  ChapterProgress,
  LearningProfile,
  StrongTopic,
  TopicProgress,
  UnfinishedTopic,
  WeakTopic,
} from "../progress/types.js";
import type {
  ContextEntity,
  ContextMessage,
  ModelLearningProfile,
  ModelStudentLearningContext,
} from "./learning-context.types.js";

export function normalizeContextLabel(value: string | null | undefined): string {
  return (value ?? "").trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

function entityMatches(
  entity: { id?: string | null; name?: string | null; code?: string | null } | null | undefined,
  focus: { id?: string | null; name?: string | null; code?: string | null } | null | undefined
): boolean {
  if (!entity || !focus) return false;
  if (entity.id && focus.id && entity.id === focus.id) return true;
  const name = normalizeContextLabel(entity.name);
  const focusName = normalizeContextLabel(focus.name);
  if (name && focusName && name === focusName) return true;
  const code = normalizeContextLabel(entity.code);
  const focusCode = normalizeContextLabel(focus.code);
  return Boolean(code && focusCode && code === focusCode);
}

function topicMatches(
  topic: Pick<TopicProgress, "id" | "title"> | Pick<WeakTopic, "id" | "title"> | Pick<StrongTopic, "id" | "title"> | Pick<UnfinishedTopic, "id" | "title">,
  focusTopic: { id?: string | null; name?: string | null } | null | undefined
): boolean {
  if (!focusTopic) return false;
  if (focusTopic.id) return topic.id === focusTopic.id;
  const title = normalizeContextLabel(topic.title);
  const focusName = normalizeContextLabel(focusTopic.name);
  return Boolean(title && focusName && title === focusName);
}

function subjectMatches(
  subject: { id: string; name: string; code: string | null },
  focus: { id?: string | null; name?: string | null; code?: string | null } | null | undefined
): boolean {
  return entityMatches(subject, focus);
}

function chapterMatches(
  chapter: Pick<ChapterProgress, "id" | "title" | "subject_id">,
  focus: { id?: string | null; name?: string | null } | null | undefined,
  subjectId: string | null
): boolean {
  if (focus && (entityMatches(chapter, focus) || (focus.name && normalizeContextLabel(chapter.title) === normalizeContextLabel(focus.name)))) return true;
  return Boolean(subjectId && chapter.subject_id === subjectId);
}

export interface LearningProfileFocus {
  subject?: ContextEntity | null;
  chapter?: ContextEntity | null;
  topic?: ContextEntity | null;
}

/**
 * Select already-derived Epic 10 fields for the current task.  This function
 * only filters the authoritative profile; it does not calculate, classify,
 * rank, recommend, or alter any Epic 10 value.
 */
export function selectRelevantLearningProfile(
  profile: LearningProfile,
  focus: LearningProfileFocus
): ModelLearningProfile | undefined {
  const subject = focus.subject?.status === "resolved" ? focus.subject : null;
  const chapter = focus.chapter?.status === "resolved" ? focus.chapter : null;
  const topic = focus.topic?.status === "resolved" ? focus.topic : null;
  if (!subject && !chapter && !topic) return undefined;

  const selectedSubjects = profile.subject_progress.subjects.filter((item) => subjectMatches(item, subject));
  const subjectIds = new Set(selectedSubjects.map((item) => item.id));
  const selectedChapters = profile.chapter_progress.chapters.filter((item) =>
    chapterMatches(item, chapter, subject?.id ?? null) ||
    (subjectIds.has(item.subject_id ?? "") && !chapter)
  );
  const chapterIds = new Set(selectedChapters.map((item) => item.id));
  const selectedTopics = profile.topic_progress.topics.filter((item) => {
    if (topicMatches(item, topic)) return true;
    if (topic) return false;
    if (chapter && item.chapter_id && chapterIds.has(item.chapter_id)) return true;
    return !chapter && !subject ? false : chapterIds.has(item.chapter_id ?? "");
  });

  const subjectNames = new Map(selectedSubjects.map((item) => [item.id, item.name]));
  const chapterTitles = new Map(profile.chapter_progress.chapters.map((item) => [item.id, item.title]));
  const result: ModelLearningProfile = {};

  if (selectedSubjects.length > 0) {
    result.subject_progress = selectedSubjects.map((item) => ({
      name: item.name,
      code: item.code,
      completed: item.completed,
      available: item.available,
      percentage: item.percentage,
    }));
  }
  if (selectedChapters.length > 0) {
    result.chapter_progress = selectedChapters.map((item) => ({
      title: item.title,
      subject: item.subject_id ? (subjectNames.get(item.subject_id) ?? null) : null,
      completed: item.completed,
      available: item.available,
      percentage: item.percentage,
    }));
  }
  if (selectedTopics.length > 0) {
    result.topic_progress = selectedTopics.map((item) => ({
      title: item.title,
      chapter: item.chapter_id ? (chapterTitles.get(item.chapter_id) ?? null) : null,
      completed: item.completed,
      available: item.available,
      percentage: item.percentage,
    }));
  }

  const topicId = topic?.id ?? null;
  const hasAuthoritativeTopicId = Boolean(topicId);
  const strong = hasAuthoritativeTopicId
    ? profile.strong_topics.strong_topics.filter((item) => topicMatches(item, topic))
    : [];
  if (strong.length > 0) {
    result.strong_topics = strong.map((item) => ({
      title: item.title,
      performance: item.performance,
      answered_responses: item.answered_responses,
    }));
  }

  const weak = hasAuthoritativeTopicId
    ? profile.weak_topics.weak_topics.filter((item) => topicMatches(item, topic))
    : [];
  if (weak.length > 0) {
    result.weak_topics = weak.map((item) => ({
      title: item.title,
      performance: item.performance,
      answered_responses: item.answered_responses,
    }));
  }

  const unfinished = hasAuthoritativeTopicId
    ? profile.unfinished_learning.topics.filter((item) => topicMatches(item, topic))
    : [];
  if (unfinished.length > 0) {
    result.unfinished_learning = unfinished.map((item) => ({
      title: item.title,
      completed: item.completed,
      available: item.available,
      status: item.status,
    }));
  }

  // Practice/formal result rows do not carry authoritative curriculum IDs.
  // Keep the complete rows in the internal Epic 10 profile, but do not send a
  // label-only match to the model because the same title can exist in another
  // class or subject.
  return Object.keys(result).length > 0 ? result : undefined;
}

function safeHistory(history: ContextMessage[]): ContextMessage[] {
  return history
    .filter((message) => message.role === "user" || message.role === "assistant")
    .map((message) => ({ role: message.role, content: message.content }));
}

/**
 * Create the concise, privacy-preserving representation sent to the model.
 * Internal IDs, assembly metadata, and the complete profile never cross this
 * boundary.
 */
export function toModelLearningContext(
  context: {
    currentClass: ContextEntity;
    board: ContextEntity;
    medium: ContextEntity;
    languages: ContextEntity[];
    subject: ContextEntity;
    chapter: ContextEntity;
    topic: ContextEntity;
    learningProfile: LearningProfile | null;
    modelContext?: ModelStudentLearningContext;
    conversation: { history: ContextMessage[] };
  },
  maxTokens = 6000
): { context: ModelStudentLearningContext; truncated: boolean } {
  if (context.modelContext) {
    return applyContextTokenBudget(
      {
        ...context.modelContext,
        conversationHistory: context.modelContext.conversationHistory.map((message) => ({ ...message })),
      },
      maxTokens
    );
  }

  const relevant = context.learningProfile
    ? selectRelevantLearningProfile(context.learningProfile, {
        subject: context.subject,
        chapter: context.chapter,
        topic: context.topic,
      })
    : undefined;

  const modelContext: ModelStudentLearningContext = {
    ...(context.currentClass.status === "resolved" && context.currentClass.name
      ? { currentClass: context.currentClass.name }
      : {}),
    ...(context.board.status === "resolved" && context.board.name
      ? { board: context.board.name }
      : {}),
    ...(context.medium.status === "resolved" && context.medium.name
      ? { medium: context.medium.name }
      : {}),
    ...(context.languages.some((language) => language.status === "resolved" && language.name)
      ? {
          languages: context.languages
            .filter((language) => language.status === "resolved" && language.name)
            .map((language) => language.name as string),
        }
      : {}),
    ...(context.subject.status === "resolved" && context.subject.name
      ? { subject: context.subject.name }
      : {}),
    ...(context.chapter.status === "resolved" && context.chapter.name
      ? { chapter: context.chapter.name }
      : {}),
    ...(context.topic.status === "resolved" && context.topic.name
      ? { topic: context.topic.name }
      : {}),
    ...(relevant ? { learningProfile: relevant } : {}),
    conversationHistory: safeHistory(context.conversation.history),
  };

  return applyContextTokenBudget(modelContext, maxTokens);
}

export function estimateContextTokens(value: unknown): number {
  const serialized = typeof value === "string" ? value : JSON.stringify(value);
  return Math.ceil((serialized?.length ?? 0) / 4);
}

/**
 * Reduce optional context in a deterministic priority order.  Authoritative
 * labels and recent history are retained before optional profile sections;
 * this function never changes a source value.
 */
export function applyContextTokenBudget(
  context: ModelStudentLearningContext,
  maxTokens = 6000
): { context: ModelStudentLearningContext; truncated: boolean } {
  const result: ModelStudentLearningContext = {
    ...context,
    conversationHistory: context.conversationHistory.map((message) => ({ ...message })),
  };
  let truncated = false;
  const limit = Math.max(256, maxTokens);

  while (estimateContextTokens(result) > limit && result.conversationHistory.length > 1) {
    result.conversationHistory.shift();
    truncated = true;
  }
  if (estimateContextTokens(result) > limit && result.conversationHistory.length === 1) {
    const last = result.conversationHistory[0];
    const maxCharacters = Math.max(256, limit * 4);
    if (last.content.length > maxCharacters) {
      last.content = `${last.content.slice(0, maxCharacters - 1)}…`;
      truncated = true;
    }
  }

  const optionalProfileKeys: Array<keyof ModelLearningProfile> = [
    "formal_assessment_performance",
    "practice_performance",
    "unfinished_learning",
    "chapter_progress",
    "subject_progress",
    "strong_topics",
    "weak_topics",
    "topic_progress",
  ];
  let profile = result.learningProfile;
  while (estimateContextTokens(result) > limit && profile) {
    const next = { ...profile };
    const key = optionalProfileKeys.find((candidate) => Array.isArray(next[candidate]) && (next[candidate] as unknown[]).length > 0);
    if (!key) break;
    delete next[key];
    profile = Object.keys(next).length > 0 ? next : undefined;
    result.learningProfile = profile;
    truncated = true;
  }

  return { context: result, truncated };
}

/** Render only safe, already-projected model context for the prompt layer. */
export function renderModelLearningContext(context: ModelStudentLearningContext): string {
  const lines: string[] = [];
  if (context.currentClass) lines.push(`Class: ${context.currentClass}`);
  if (context.board) lines.push(`Board: ${context.board}`);
  if (context.medium) lines.push(`Medium: ${context.medium}`);
  if (context.languages?.length) lines.push(`Syllabus language${context.languages.length === 1 ? "" : "s"}: ${context.languages.join(", ")}`);
  if (context.subject) lines.push(`Subject: ${context.subject}`);
  if (context.chapter) lines.push(`Chapter: ${context.chapter}`);
  if (context.topic) lines.push(`Topic: ${context.topic}`);

  const profile = context.learningProfile;
  if (profile) {
    if (profile.topic_progress?.length) {
      lines.push(
        `Relevant topic progress: ${profile.topic_progress
          .map((item) => `${item.title} (${item.percentage === null ? "no progress data" : `${item.percentage}%`})`)
          .join("; ")}`
      );
    }
    if (profile.subject_progress?.length) {
      lines.push(
        `Relevant subject progress: ${profile.subject_progress
          .map((item) => `${item.name} (${item.percentage === null ? "no progress data" : `${item.percentage}%`})`)
          .join("; ")}`
      );
    }
    if (profile.chapter_progress?.length) {
      lines.push(
        `Relevant chapter progress: ${profile.chapter_progress
          .map((item) => `${item.title} (${item.percentage === null ? "no progress data" : `${item.percentage}%`})`)
          .join("; ")}`
      );
    }
    if (profile.practice_performance?.length) {
      lines.push(
        `Relevant practice results: ${profile.practice_performance
          .map((item) => `${item.practice_title} (${item.percentage}%)`)
          .join("; ")}`
      );
    }
    if (profile.formal_assessment_performance?.length) {
      lines.push(
        `Relevant assessment results: ${profile.formal_assessment_performance
          .map((item) => `${item.assessment_title} (${item.percentage}%)`)
          .join("; ")}`
      );
    }
    if (profile.weak_topics?.length) {
      lines.push(
        `Relevant weak topics: ${profile.weak_topics
          .map((item) => `${item.title} (${item.performance}%)`)
          .join("; ")}`
      );
    }
    if (profile.strong_topics?.length) {
      lines.push(
        `Relevant strong topics: ${profile.strong_topics
          .map((item) => `${item.title} (${item.performance}%)`)
          .join("; ")}`
      );
    }
    if (profile.unfinished_learning?.length) {
      lines.push(
        `Relevant unfinished learning: ${profile.unfinished_learning
          .map((item) => `${item.title} (${item.status ?? "unavailable"})`)
          .join("; ")}`
      );
    }
  }
  return lines.join("\n");
}
