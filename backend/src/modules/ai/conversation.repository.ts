import type { Pool, PoolClient } from "pg";
import pool from "../../db.js";
import type {
  BranchRecord,
  ConversationRecord,
  FeedbackRecord,
  GenerationAttemptRecord,
  GenerationAttemptType,
  IdempotencyOperation,
  IdempotencyRecord,
  MessageRecord,
  MessageStatus,
} from "./conversation.types.js";

export type ConversationQueryable = Pick<Pool, "query"> | PoolClient;

export interface ConversationInsertInput {
  organizationId: string;
  studentId: string;
  title: string;
  titleSource: "DEFAULT" | "GENERATED" | "RENAMED";
  subject: string | null;
  topic: string | null;
  scopeBoard: string | null;
  scopeClass: string | null;
  scopeChapter: string | null;
  scopeLanguage: string | null;
  scopeMedium: string | null;
}

export interface MessageInsertInput {
  conversationId: string;
  role: "user" | "assistant";
  content: string;
  status: MessageStatus;
  branchId: string;
  sequenceNumber: number;
  variantNumber?: number;
  parentMessageId?: string | null;
  originalMessageId?: string | null;
  requestMessageId?: string | null;
  generationAttemptId?: string | null;
}

export interface AttemptInsertInput {
  conversationId: string;
  organizationId: string;
  studentId: string;
  userId: string;
  branchId: string;
  requestMessageId: string;
  attemptType: GenerationAttemptType;
  attemptNumber: number;
  provider: string;
  model: string;
  retryOfAttemptId?: string | null;
  parentAttemptId?: string | null;
}

export interface IdempotencyInsertInput {
  organizationId: string;
  studentId: string;
  userId: string;
  operation: IdempotencyOperation;
  idempotencyKey: string;
  requestHash: string;
}

const CONVERSATION_COLUMNS = `
  id, organization_id, student_id, title, title_source,
  subject, topic, scope_board, scope_class, scope_chapter,
  scope_language, scope_medium, active_branch_id, deleted_at,
  created_at, updated_at
`;

const MESSAGE_COLUMNS = `
  id, conversation_id, role, content, status, branch_id,
  parent_message_id, original_message_id, request_message_id,
  sequence_number, variant_number, generation_attempt_id, created_at
`;

const ATTEMPT_COLUMNS = `
  id, conversation_id, organization_id, student_id, user_id,
  branch_id, request_message_id, response_message_id, attempt_type,
  attempt_number, retry_of_attempt_id, parent_attempt_id, status,
  provider, model, request_id, error_category, usage_event_id,
  started_at, completed_at, created_at, updated_at
`;

export class ConversationRepository {
  constructor(readonly db: ConversationQueryable = pool) {}

  async transaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
    const connectable = this.db as Pool;
    const client = await connectable.connect();
    try {
      await client.query("BEGIN");
      const result = await callback(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async getIdempotencyRecord(
    client: ConversationQueryable,
    organizationId: string,
    studentId: string,
    userId: string,
    operation: IdempotencyOperation,
    idempotencyKey: string,
    lock = false
  ): Promise<IdempotencyRecord | null> {
    const result = await client.query(
      `SELECT id, organization_id, student_id, user_id, operation,
              idempotency_key, request_hash, conversation_id,
              request_message_id, attempt_id, created_at, updated_at
         FROM ai_idempotency_keys
        WHERE organization_id = $1
          AND student_id = $2
          AND user_id = $3
          AND operation = $4
          AND idempotency_key = $5
        LIMIT 1${lock ? " FOR UPDATE" : ""}`,
      [organizationId, studentId, userId, operation, idempotencyKey]
    );
    return (result.rows[0] as IdempotencyRecord | undefined) ?? null;
  }

  async insertIdempotencyRecord(
    client: ConversationQueryable,
    input: IdempotencyInsertInput
  ): Promise<IdempotencyRecord | null> {
    const result = await client.query(
      `INSERT INTO ai_idempotency_keys
         (organization_id, student_id, user_id, operation, idempotency_key, request_hash)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (organization_id, student_id, user_id, operation, idempotency_key)
       DO NOTHING
       RETURNING id, organization_id, student_id, user_id, operation,
                 idempotency_key, request_hash, conversation_id,
                 request_message_id, attempt_id, created_at, updated_at`,
      [
        input.organizationId,
        input.studentId,
        input.userId,
        input.operation,
        input.idempotencyKey,
        input.requestHash,
      ]
    );
    return (result.rows[0] as IdempotencyRecord | undefined) ?? null;
  }

  async linkIdempotencyRecord(
    client: ConversationQueryable,
    idempotencyId: string,
    conversationId: string,
    requestMessageId: string | null,
    attemptId: string | null
  ): Promise<void> {
    await client.query(
      `UPDATE ai_idempotency_keys
          SET conversation_id = $2,
              request_message_id = $3,
              attempt_id = $4,
              updated_at = NOW()
        WHERE id = $1`,
      [idempotencyId, conversationId, requestMessageId, attemptId]
    );
  }

  async insertConversation(
    client: ConversationQueryable,
    input: ConversationInsertInput
  ): Promise<ConversationRecord> {
    const result = await client.query(
      `INSERT INTO ai_conversations
         (organization_id, student_id, title, title_source, subject, topic,
          scope_board, scope_class, scope_chapter, scope_language, scope_medium)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING ${CONVERSATION_COLUMNS}`,
      [
        input.organizationId,
        input.studentId,
        input.title,
        input.titleSource,
        input.subject,
        input.topic,
        input.scopeBoard,
        input.scopeClass,
        input.scopeChapter,
        input.scopeLanguage,
        input.scopeMedium,
      ]
    );
    return result.rows[0] as ConversationRecord;
  }

  async insertPrimaryBranch(
    client: ConversationQueryable,
    conversationId: string
  ): Promise<BranchRecord> {
    await client.query(
      `INSERT INTO ai_conversation_branches (conversation_id, is_primary, name)
       SELECT $1, TRUE, 'Primary'
       WHERE NOT EXISTS (
         SELECT 1 FROM ai_conversation_branches WHERE conversation_id = $1
       )`,
      [conversationId]
    );
    const result = await client.query(
      `SELECT id, conversation_id, parent_branch_id, branch_point_message_id,
              name, is_primary, created_at, updated_at
         FROM ai_conversation_branches
        WHERE conversation_id = $1 AND is_primary = TRUE
        LIMIT 1`,
      [conversationId]
    );
    return result.rows[0] as BranchRecord;
  }

  async insertBranch(
    client: ConversationQueryable,
    input: {
      conversationId: string;
      parentBranchId: string;
      branchPointMessageId: string;
      name?: string | null;
    }
  ): Promise<BranchRecord> {
    const result = await client.query(
      `INSERT INTO ai_conversation_branches
         (conversation_id, parent_branch_id, branch_point_message_id, name, is_primary)
       VALUES ($1, $2, $3, $4, FALSE)
       RETURNING id, conversation_id, parent_branch_id, branch_point_message_id,
                 name, is_primary, created_at, updated_at`,
      [input.conversationId, input.parentBranchId, input.branchPointMessageId, input.name ?? null]
    );
    return result.rows[0] as BranchRecord;
  }

  async getBranch(
    client: ConversationQueryable,
    conversationId: string,
    branchId: string
  ): Promise<BranchRecord | null> {
    const result = await client.query(
      `SELECT id, conversation_id, parent_branch_id, branch_point_message_id,
              name, is_primary, created_at, updated_at
         FROM ai_conversation_branches
        WHERE id = $1 AND conversation_id = $2
        LIMIT 1`,
      [branchId, conversationId]
    );
    return (result.rows[0] as BranchRecord | undefined) ?? null;
  }

  async hasStudentMessages(
    client: ConversationQueryable,
    conversationId: string,
    excludeMessageId?: string
  ): Promise<boolean> {
    const result = await client.query(
      `SELECT EXISTS (
         SELECT 1 FROM ai_messages
          WHERE conversation_id = $1 AND role = 'user'
            AND ($2::uuid IS NULL OR id <> $2::uuid)
       ) AS has_messages`,
      [conversationId, excludeMessageId ?? null]
    );
    return result.rows[0]?.has_messages === true;
  }

  async getConversation(
    client: ConversationQueryable,
    organizationId: string,
    studentId: string,
    conversationId: string,
    includeDeleted = false
  ): Promise<ConversationRecord | null> {
    const result = await client.query(
      `SELECT ${CONVERSATION_COLUMNS}
         FROM ai_conversations c
        WHERE c.id = $1
          AND c.organization_id = $2
          AND c.student_id = $3
          ${includeDeleted ? "" : "AND c.deleted_at IS NULL"}
        LIMIT 1`,
      [conversationId, organizationId, studentId]
    );
    return (result.rows[0] as ConversationRecord | undefined) ?? null;
  }

  async getConversationById(
    client: ConversationQueryable,
    conversationId: string,
    includeDeleted = false
  ): Promise<ConversationRecord | null> {
    const result = await client.query(
      `SELECT ${CONVERSATION_COLUMNS}
         FROM ai_conversations c
        WHERE c.id = $1
          ${includeDeleted ? "" : "AND c.deleted_at IS NULL"}
        LIMIT 1`,
      [conversationId]
    );
    return (result.rows[0] as ConversationRecord | undefined) ?? null;
  }

  async lockConversation(
    client: ConversationQueryable,
    organizationId: string,
    studentId: string,
    conversationId: string
  ): Promise<ConversationRecord | null> {
    const result = await client.query(
      `SELECT ${CONVERSATION_COLUMNS}
         FROM ai_conversations c
        WHERE c.id = $1
          AND c.organization_id = $2
          AND c.student_id = $3
          AND c.deleted_at IS NULL
        FOR UPDATE`,
      [conversationId, organizationId, studentId]
    );
    return (result.rows[0] as ConversationRecord | undefined) ?? null;
  }

  async listConversations(
    client: ConversationQueryable,
    organizationId: string,
    studentId: string,
    limit: number
  ): Promise<Array<ConversationRecord & { latest_message_preview: string | null }>> {
    const result = await client.query(
      `SELECT c.id, c.organization_id, c.student_id, c.title, c.title_source,
              c.subject, c.topic, c.scope_board, c.scope_class, c.scope_chapter,
              c.scope_language, c.scope_medium, c.active_branch_id, c.deleted_at,
              c.created_at, c.updated_at,
              latest.content AS latest_message_preview
         FROM ai_conversations c
         LEFT JOIN LATERAL (
           WITH RECURSIVE branch_path AS (
             SELECT b.id, b.parent_branch_id, b.branch_point_message_id, 0 AS depth,
                     NULL::bigint AS cutoff_sequence
               FROM ai_conversation_branches b
              WHERE b.conversation_id = c.id
                AND b.id = COALESCE(
                  c.active_branch_id,
                  (SELECT p.id FROM ai_conversation_branches p
                    WHERE p.conversation_id = c.id AND p.is_primary LIMIT 1)
                )
             UNION ALL
             SELECT parent.id, parent.parent_branch_id, parent.branch_point_message_id,
                     child.depth + 1,
                     COALESCE(point.sequence_number, 9223372036854775807::bigint)
               FROM ai_conversation_branches parent
               JOIN branch_path child ON child.parent_branch_id = parent.id
               LEFT JOIN ai_messages point
                 ON point.id = child.branch_point_message_id
                AND point.conversation_id = c.id
              WHERE parent.conversation_id = c.id AND child.depth < 100
           )
           SELECT LEFT(m.content, 200) AS content
             FROM branch_path path
             JOIN ai_messages m
               ON m.conversation_id = c.id AND m.branch_id = path.id
            WHERE (path.cutoff_sequence IS NULL OR m.sequence_number < path.cutoff_sequence)
              AND m.role IN ('user', 'assistant')
            ORDER BY COALESCE(m.sequence_number, 9223372036854775807) DESC,
                     CASE m.role WHEN 'assistant' THEN 1 ELSE 0 END DESC,
                     m.variant_number DESC, m.created_at DESC, m.id DESC
            LIMIT 1
         ) latest ON TRUE
        WHERE c.organization_id = $1
          AND c.student_id = $2
          AND c.deleted_at IS NULL
        ORDER BY c.updated_at DESC, c.id DESC
        LIMIT $3`,
      [organizationId, studentId, limit]
    );
    return result.rows as Array<ConversationRecord & { latest_message_preview: string | null }>;
  }

  async setActiveBranch(
    client: ConversationQueryable,
    organizationId: string,
    studentId: string,
    conversationId: string,
    branchId: string
  ): Promise<boolean> {
    const result = await client.query(
      `UPDATE ai_conversations c
          SET active_branch_id = $1, updated_at = NOW()
        WHERE c.id = $2
          AND c.organization_id = $3
          AND c.student_id = $4
          AND c.deleted_at IS NULL
          AND EXISTS (
            SELECT 1 FROM ai_conversation_branches b
             WHERE b.id = $1 AND b.conversation_id = c.id
          )`,
      [branchId, conversationId, organizationId, studentId]
    );
    return result.rowCount === 1;
  }

  async insertMessage(client: ConversationQueryable, input: MessageInsertInput): Promise<MessageRecord> {
    const result = await client.query(
      `INSERT INTO ai_messages
         (conversation_id, role, content, status, branch_id, parent_message_id,
          original_message_id, request_message_id, sequence_number, variant_number,
          generation_attempt_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING ${MESSAGE_COLUMNS}`,
      [
        input.conversationId,
        input.role,
        input.content,
        input.status,
        input.branchId,
        input.parentMessageId ?? null,
        input.originalMessageId ?? null,
        input.requestMessageId ?? null,
        input.sequenceNumber,
        input.variantNumber ?? 1,
        input.generationAttemptId ?? null,
      ]
    );
    return result.rows[0] as MessageRecord;
  }

  async getMessage(
    client: ConversationQueryable,
    organizationId: string,
    studentId: string,
    messageId: string,
    role?: "user" | "assistant"
  ): Promise<MessageRecord | null> {
    const result = await client.query(
      `SELECT ${MESSAGE_COLUMNS.split(",").map((column) => `m.${column.trim()}`).join(", ")}
         FROM ai_messages m
         JOIN ai_conversations c ON c.id = m.conversation_id
        WHERE m.id = $1
          AND c.organization_id = $2
          AND c.student_id = $3
          AND c.deleted_at IS NULL
          ${role ? "AND m.role = $4" : ""}
        LIMIT 1`,
      role ? [messageId, organizationId, studentId, role] : [messageId, organizationId, studentId]
    );
    return (result.rows[0] as MessageRecord | undefined) ?? null;
  }

  async getMessageForConversation(
    client: ConversationQueryable,
    conversationId: string,
    messageId: string
  ): Promise<MessageRecord | null> {
    const result = await client.query(
      `SELECT ${MESSAGE_COLUMNS.split(",").map((column) => `m.${column.trim()}`).join(", ")}
         FROM ai_messages m
        WHERE m.conversation_id = $1 AND m.id = $2
        LIMIT 1`,
      [conversationId, messageId]
    );
    return (result.rows[0] as MessageRecord | undefined) ?? null;
  }

  async getMessages(
    client: ConversationQueryable,
    conversationId: string,
    branchIds?: string[]
  ): Promise<MessageRecord[]> {
    const params: unknown[] = [conversationId];
    let branchFilter = "";
    if (branchIds && branchIds.length > 0) {
      params.push(branchIds);
      branchFilter = "AND branch_id = ANY($2::uuid[])";
    }
    const result = await client.query(
      `SELECT ${MESSAGE_COLUMNS}
         FROM ai_messages
        WHERE conversation_id = $1 ${branchFilter}
        ORDER BY COALESCE(sequence_number, 9223372036854775807) ASC,
                 CASE role WHEN 'user' THEN 0 ELSE 1 END ASC,
                 variant_number ASC,
                 created_at ASC,
                 id ASC`,
      params
    );
    return result.rows as MessageRecord[];
  }

  async getActiveBranchChain(
    client: ConversationQueryable,
    conversationId: string,
    branchId: string
  ): Promise<BranchRecord[]> {
    const result = await client.query(
      `WITH RECURSIVE branch_chain AS (
         SELECT b.id, b.conversation_id, b.parent_branch_id, b.branch_point_message_id,
                b.name, b.is_primary, b.created_at, b.updated_at,
                ARRAY[b.id]::uuid[] AS branch_path, 0 AS depth
           FROM ai_conversation_branches b
          WHERE b.id = $1 AND b.conversation_id = $2
         UNION ALL
         SELECT parent.id, parent.conversation_id, parent.parent_branch_id,
                parent.branch_point_message_id, parent.name, parent.is_primary,
                parent.created_at, parent.updated_at,
                child.branch_path || parent.id, child.depth + 1
           FROM ai_conversation_branches parent
           JOIN branch_chain child ON child.parent_branch_id = parent.id
          WHERE parent.conversation_id = child.conversation_id
            AND child.depth < 100
            AND NOT parent.id = ANY(child.branch_path)
       )
       SELECT * FROM branch_chain ORDER BY depth DESC`,
      [branchId, conversationId]
    );
    return result.rows as BranchRecord[];
  }

  async getBranches(
    client: ConversationQueryable,
    conversationId: string,
    activeBranchId: string | null
  ): Promise<BranchRecord[]> {
    const result = await client.query(
      `SELECT b.id, b.conversation_id, b.parent_branch_id, b.branch_point_message_id,
              b.name, b.is_primary, b.created_at, b.updated_at,
              (b.id = $2) AS is_active
         FROM ai_conversation_branches b
        WHERE b.conversation_id = $1
        ORDER BY b.created_at ASC, b.id ASC`,
      [conversationId, activeBranchId]
    );
    return result.rows as BranchRecord[];
  }

  async getNextSequence(
    client: ConversationQueryable,
    conversationId: string,
    branchIds: string[]
  ): Promise<number> {
    const result = await client.query(
      `SELECT COALESCE(MAX(sequence_number), 0) + 1 AS next_sequence
         FROM ai_messages
        WHERE conversation_id = $1
          AND branch_id = ANY($2::uuid[])`,
      [conversationId, branchIds]
    );
    return Number(result.rows[0]?.next_sequence ?? 1);
  }

  async getNextAttemptNumber(
    client: ConversationQueryable,
    requestMessageId: string
  ): Promise<number> {
    const result = await client.query(
      `SELECT COALESCE(MAX(attempt_number), 0) + 1 AS next_attempt
         FROM ai_generation_attempts
        WHERE request_message_id = $1`,
      [requestMessageId]
    );
    return Number(result.rows[0]?.next_attempt ?? 1);
  }

  async getNextVariantNumber(
    client: ConversationQueryable,
    requestMessageId: string
  ): Promise<number> {
    const result = await client.query(
      `SELECT COALESCE(MAX(variant_number), 0) + 1 AS next_variant
         FROM ai_messages
        WHERE request_message_id = $1 AND role = 'assistant'`,
      [requestMessageId]
    );
    return Number(result.rows[0]?.next_variant ?? 1);
  }

  async insertAttempt(
    client: ConversationQueryable,
    input: AttemptInsertInput
  ): Promise<GenerationAttemptRecord> {
    const result = await client.query(
      `INSERT INTO ai_generation_attempts
         (conversation_id, organization_id, student_id, user_id, branch_id,
          request_message_id, attempt_type, attempt_number, retry_of_attempt_id,
          parent_attempt_id, status, provider, model)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'PROCESSING', $11, $12)
       RETURNING ${ATTEMPT_COLUMNS}`,
      [
        input.conversationId,
        input.organizationId,
        input.studentId,
        input.userId,
        input.branchId,
        input.requestMessageId,
        input.attemptType,
        input.attemptNumber,
        input.retryOfAttemptId ?? null,
        input.parentAttemptId ?? null,
        input.provider,
        input.model,
      ]
    );
    return result.rows[0] as GenerationAttemptRecord;
  }

  async getAttemptsForConversation(
    client: ConversationQueryable,
    conversationId: string
  ): Promise<GenerationAttemptRecord[]> {
    const result = await client.query(
      `SELECT ${ATTEMPT_COLUMNS.split(",").map((column) => `a.${column.trim()}`).join(", ")}
         FROM ai_generation_attempts a
        WHERE a.conversation_id = $1
        ORDER BY a.created_at ASC, a.id ASC`,
      [conversationId]
    );
    return result.rows as GenerationAttemptRecord[];
  }

  async getAttemptIncludingDeleted(
    client: ConversationQueryable,
    organizationId: string,
    studentId: string,
    attemptId: string
  ): Promise<GenerationAttemptRecord | null> {
    const result = await client.query(
      `SELECT ${ATTEMPT_COLUMNS.split(",").map((column) => `a.${column.trim()}`).join(", ")}
         FROM ai_generation_attempts a
         JOIN ai_conversations c ON c.id = a.conversation_id
        WHERE a.id = $1
          AND c.organization_id = $2
          AND c.student_id = $3
        LIMIT 1`,
      [attemptId, organizationId, studentId]
    );
    return (result.rows[0] as GenerationAttemptRecord | undefined) ?? null;
  }

  async getAttempt(
    client: ConversationQueryable,
    organizationId: string,
    studentId: string,
    attemptId: string
  ): Promise<GenerationAttemptRecord | null> {
    const result = await client.query(
      `SELECT ${ATTEMPT_COLUMNS.split(",").map((column) => `a.${column.trim()}`).join(", ")}
         FROM ai_generation_attempts a
         JOIN ai_conversations c ON c.id = a.conversation_id
        WHERE a.id = $1
          AND c.organization_id = $2
          AND c.student_id = $3
          AND c.deleted_at IS NULL
        LIMIT 1`,
      [attemptId, organizationId, studentId]
    );
    return (result.rows[0] as GenerationAttemptRecord | undefined) ?? null;
  }

  async getLatestAttemptForRequest(
    client: ConversationQueryable,
    requestMessageId: string
  ): Promise<GenerationAttemptRecord | null> {
    const result = await client.query(
      `SELECT ${ATTEMPT_COLUMNS}
         FROM ai_generation_attempts
        WHERE request_message_id = $1
        ORDER BY attempt_number DESC, created_at DESC, id DESC
        LIMIT 1`,
      [requestMessageId]
    );
    return (result.rows[0] as GenerationAttemptRecord | undefined) ?? null;
  }

  async getLatestAttemptForMessage(
    client: ConversationQueryable,
    messageId: string
  ): Promise<GenerationAttemptRecord | null> {
    const result = await client.query(
      `SELECT ${ATTEMPT_COLUMNS}
         FROM ai_generation_attempts
        WHERE request_message_id = $1
        ORDER BY attempt_number DESC, created_at DESC, id DESC
        LIMIT 1`,
      [messageId]
    );
    return (result.rows[0] as GenerationAttemptRecord | undefined) ?? null;
  }

  async getCompletedRequestMessageIds(
    client: ConversationQueryable,
    conversationId: string
  ): Promise<Set<string>> {
    const result = await client.query(
      `SELECT DISTINCT request_message_id
         FROM ai_generation_attempts
        WHERE conversation_id = $1 AND status = 'COMPLETED'`,
      [conversationId]
    );
    return new Set(result.rows.map((row) => row.request_message_id as string));
  }

  async updateAttemptCompleted(
    client: ConversationQueryable,
    attemptId: string,
    responseMessageId: string,
    provider: string,
    model: string,
    requestId: string | null,
    usageEventId: string
  ): Promise<GenerationAttemptRecord | null> {
    const result = await client.query(
      `UPDATE ai_generation_attempts
          SET status = 'COMPLETED', response_message_id = $2, provider = $3,
              model = $4, request_id = COALESCE($5, request_id),
              usage_event_id = COALESCE($6, usage_event_id), completed_at = NOW(),
              updated_at = NOW()
        WHERE id = $1
        RETURNING ${ATTEMPT_COLUMNS}`,
      [attemptId, responseMessageId, provider, model, requestId, usageEventId]
    );
    return (result.rows[0] as GenerationAttemptRecord | undefined) ?? null;
  }

  async updateAttemptFailed(
    client: ConversationQueryable,
    attemptId: string,
    provider: string,
    model: string,
    errorCategory: string,
    usageEventId: string | null
  ): Promise<GenerationAttemptRecord | null> {
    const result = await client.query(
      `UPDATE ai_generation_attempts
          SET status = 'FAILED', provider = $2, model = $3, error_category = $4,
              usage_event_id = COALESCE($5, usage_event_id), completed_at = NOW(),
              updated_at = NOW()
        WHERE id = $1
        RETURNING ${ATTEMPT_COLUMNS}`,
      [attemptId, provider, model, errorCategory, usageEventId]
    );
    return (result.rows[0] as GenerationAttemptRecord | undefined) ?? null;
  }

  async updateMessageStatus(
    client: ConversationQueryable,
    messageId: string,
    status: MessageStatus
  ): Promise<MessageRecord | null> {
    const result = await client.query(
      `UPDATE ai_messages
          SET status = $2
        WHERE id = $1
        RETURNING ${MESSAGE_COLUMNS}`,
      [messageId, status]
    );
    return (result.rows[0] as MessageRecord | undefined) ?? null;
  }

  async updateConversationTimestamp(client: ConversationQueryable, conversationId: string): Promise<void> {
    await client.query(
      `UPDATE ai_conversations SET updated_at = NOW() WHERE id = $1`,
      [conversationId]
    );
  }

  async updateGeneratedTitle(
    client: ConversationQueryable,
    conversationId: string,
    title: string
  ): Promise<void> {
    await client.query(
      `UPDATE ai_conversations
          SET title = $2, title_source = 'GENERATED', updated_at = NOW()
        WHERE id = $1
          AND title_source = 'DEFAULT'
          AND deleted_at IS NULL`,
      [conversationId, title]
    );
  }

  async updateConversationScope(
    client: ConversationQueryable,
    organizationId: string,
    studentId: string,
    conversationId: string,
    scope: {
      board?: string | null;
      class?: string | null;
      subject?: string | null;
      chapter?: string | null;
      topic?: string | null;
      language?: string | null;
      medium?: string | null;
    }
  ): Promise<ConversationRecord | null> {
    const current = await this.getConversation(
      client,
      organizationId,
      studentId,
      conversationId
    );
    if (!current) return null;
    const next = {
      board: scope.board === undefined ? current.scope_board : scope.board,
      class: scope.class === undefined ? current.scope_class : scope.class,
      subject: scope.subject === undefined ? current.subject : scope.subject,
      chapter: scope.chapter === undefined ? current.scope_chapter : scope.chapter,
      topic: scope.topic === undefined ? current.topic : scope.topic,
      language: scope.language === undefined ? current.scope_language : scope.language,
      medium: scope.medium === undefined ? current.scope_medium : scope.medium,
    };
    const result = await client.query(
      `UPDATE ai_conversations
          SET subject = $4,
              topic = $5,
              scope_board = $6,
              scope_class = $7,
              scope_chapter = $8,
              scope_language = $9,
              scope_medium = $10,
              updated_at = NOW()
        WHERE id = $1
          AND organization_id = $2
          AND student_id = $3
          AND deleted_at IS NULL
        RETURNING ${CONVERSATION_COLUMNS}`,
      [
        conversationId,
        organizationId,
        studentId,
        next.subject,
        next.topic,
        next.board,
        next.class,
        next.chapter,
        next.language,
        next.medium,
      ]
    );
    return (result.rows[0] as ConversationRecord | undefined) ?? null;
  }

  async renameConversation(
    client: ConversationQueryable,
    organizationId: string,
    studentId: string,
    conversationId: string,
    title: string
  ): Promise<ConversationRecord | null> {
    const result = await client.query(
      `UPDATE ai_conversations
          SET title = $4, title_source = 'RENAMED', updated_at = NOW()
        WHERE id = $1 AND organization_id = $2 AND student_id = $3
          AND deleted_at IS NULL
        RETURNING ${CONVERSATION_COLUMNS}`,
      [conversationId, organizationId, studentId, title]
    );
    return (result.rows[0] as ConversationRecord | undefined) ?? null;
  }

  async softDeleteConversation(
    client: ConversationQueryable,
    organizationId: string,
    studentId: string,
    conversationId: string
  ): Promise<ConversationRecord | null> {
    const result = await client.query(
      `UPDATE ai_conversations
          SET deleted_at = NOW(), updated_at = NOW()
        WHERE id = $1 AND organization_id = $2 AND student_id = $3
          AND deleted_at IS NULL
        RETURNING ${CONVERSATION_COLUMNS}`,
      [conversationId, organizationId, studentId]
    );
    return (result.rows[0] as ConversationRecord | undefined) ?? null;
  }

  async insertFeedback(
    client: ConversationQueryable,
    input: {
      conversationId: string;
      responseMessageId: string;
      organizationId: string;
      studentId: string;
      sentiment: "HELPFUL" | "NOT_HELPFUL";
      reason: string | null;
    }
  ): Promise<FeedbackRecord> {
    const result = await client.query(
      `INSERT INTO ai_message_feedback
         (conversation_id, response_message_id, organization_id, student_id, sentiment, reason)
       SELECT c.id, m.id, c.organization_id, c.student_id, $5, $6
         FROM ai_conversations c
         JOIN ai_messages m ON m.conversation_id = c.id AND m.id = $2
        WHERE c.id = $1
          AND c.organization_id = $3
          AND c.student_id = $4
          AND c.deleted_at IS NULL
          AND m.role = 'assistant'
        RETURNING id, conversation_id, response_message_id, organization_id,
                  student_id, sentiment, reason, created_at, updated_at`,
      [
        input.conversationId,
        input.responseMessageId,
        input.organizationId,
        input.studentId,
        input.sentiment,
        input.reason,
      ]
    );
    if (result.rows.length === 0) {
      throw new Error("Response not found");
    }
    return result.rows[0] as FeedbackRecord;
  }

  async getFeedback(
    client: ConversationQueryable,
    responseMessageId: string
  ): Promise<FeedbackRecord | null> {
    const result = await client.query(
      `SELECT id, conversation_id, response_message_id, organization_id,
              student_id, sentiment, reason, created_at, updated_at
         FROM ai_message_feedback
        WHERE response_message_id = $1
        LIMIT 1`,
      [responseMessageId]
    );
    return (result.rows[0] as FeedbackRecord | undefined) ?? null;
  }

  async listFeedbackForConversation(
    client: ConversationQueryable,
    conversationId: string
  ): Promise<FeedbackRecord[]> {
    const result = await client.query(
      `SELECT id, conversation_id, response_message_id, organization_id,
              student_id, sentiment, reason, created_at, updated_at
         FROM ai_message_feedback
        WHERE conversation_id = $1
        ORDER BY created_at ASC, id ASC`,
      [conversationId]
    );
    return result.rows as FeedbackRecord[];
  }
}
