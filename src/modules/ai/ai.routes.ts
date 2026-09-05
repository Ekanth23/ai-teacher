import { Router } from "express";
import pool from "../../db.js";
import { generateTutorReply } from "./ai.service.js";

const router = Router();

const HISTORY_LIMIT = 20;

router.post("/reply", async (req, res) => {
  try {
    const { conversation_id, question } = req.body;

    if (!conversation_id || !question) {
      return res.status(400).json({
        status: "error",
        message: "conversation_id and question are required",
      });
    }

    const conversationResult = await pool.query(
      `SELECT id, student_id, subject, topic
       FROM ai_conversations
       WHERE id = $1`,
      [conversation_id]
    );

    const conversation = conversationResult.rows[0];

    if (!conversation) {
      return res.status(404).json({
        status: "error",
        message: "Conversation not found",
      });
    }

    const studentResult = await pool.query(
      `SELECT id, full_name AS name, grade_level AS grade
       FROM students_v2
       WHERE id = $1`,
      [conversation.student_id]
    );

    const student = studentResult.rows[0];

    if (!student) {
      return res.status(404).json({
        status: "error",
        message: "Student not found for this conversation",
      });
    }

    const historyResult = await pool.query(
      `SELECT role, content
       FROM ai_messages
       WHERE conversation_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [conversation_id, HISTORY_LIMIT]
    );

    const conversationHistory = historyResult.rows.reverse();

    const aiAnswer = await generateTutorReply(
      {
        question,
        subject: conversation.subject,
        topic: conversation.topic,
        studentGrade: student.grade,
        conversationHistory,
      },
      {
        context: {
          conversationId: String(conversation_id),
          studentId: String(conversation.student_id),
        },
      }
    );

    const result = await pool.query(
      `INSERT INTO ai_messages (conversation_id, role, content)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [conversation_id, "assistant", aiAnswer]
    );

    res.status(201).json({
      status: "success",
      message: "AI reply created successfully",
      data: result.rows[0],
    });
  } catch (error) {
    console.error("AI reply error:", error);

    res.status(500).json({
      status: "error",
      message: "Failed to generate AI reply",
    });
  }
});

export default router;