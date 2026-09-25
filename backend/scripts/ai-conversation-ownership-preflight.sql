-- US-117 deployment preflight. A non-empty result is a STOP condition.
-- Do not delete or reassign rows automatically; reconcile the ownership data
-- with the owning students_v2 records, then rerun this query.
SELECT
  c.id,
  c.organization_id AS conversation_organization_id,
  c.student_id,
  s.organization_id AS student_organization_id
FROM ai_conversations c
LEFT JOIN students_v2 s ON s.id = c.student_id
WHERE s.id IS NULL
   OR c.organization_id IS DISTINCT FROM s.organization_id;
