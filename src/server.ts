import express from "express";
import cors from "cors";
import pool from "./db.js";
import { DuplicateUserError, ValidationError, registerUser } from "./auth/register.js";

const app = express();

app.use(cors());
app.use(express.json());

app.get("/api/health", (req, res) => {
    res.json({
        status: "success",
        message: "AI Teacher backend is running!"
    });
});

app.get("/api/db-test", async (req, res) => {
    try {
        const result = await pool.query("SELECT NOW()");

        res.json({
            status: "success",
            message: "PostgreSQL connection is working!",
            time: result.rows[0].now
        });
    } catch (error) {
        console.error("Database connection error:", error);

        res.status(500).json({
            status: "error",
            message: "Database connection failed"
        });
    }
});


app.post("/api/students", async (req, res) => {
    try {
        const { name, email, grade } = req.body;

        const result = await pool.query(
            `INSERT INTO students (name, email, grade)
             VALUES ($1, $2, $3)
             RETURNING *`,
            [name, email, grade]
        );

        res.status(201).json({
            status: "success",
            message: "Student created successfully",
            student: result.rows[0]
        });

    } catch (error) {
        console.error("Error creating student:", error);

        res.status(500).json({
            status: "error",
            message: "Failed to create student"
        });
    }
});

app.get("/api/students", async (req, res) => {
    try {
        const result = await pool.query(
            "SELECT * FROM students ORDER BY id"
        );

        res.json({
            status: "success",
            students: result.rows
        });

    } catch (error) {
        console.error("Error fetching students:", error);

        res.status(500).json({
            status: "error",
            message: "Failed to fetch students"
        });
    }
});

//Get one student by ID
app.get("/api/students/:id", async (req, res) => {
    try {
        const { id } = req.params;

        const result = await pool.query(
            "SELECT * FROM students WHERE id = $1",
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                status: "error",
                message: "Student not found"
            });
        }

        res.json({
            status: "success",
            student: result.rows[0]
        });

    } catch (error) {
        console.error("Error fetching student:", error);

        res.status(500).json({
            status: "error",
            message: "Failed to fetch student"
        });
    }
});

//PUT API

app.put("/api/students/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { name, email, grade } = req.body;

    const result = await pool.query(
      `UPDATE students
       SET name = $1,
           email = $2,
           grade = $3,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $4
       RETURNING *`,
      [name, email, grade, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        status: "error",
        message: "Student not found"
      });
    }

    res.json({
      status: "success",
      message: "Student updated successfully",
      student: result.rows[0]
    });

  } catch (error) {
    console.error("Update student error:", error);

    res.status(500).json({
      status: "error",
      message: "Failed to update student"
    });
  }
});

//Delete API
app.delete("/api/students/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `DELETE FROM students
       WHERE id = $1
       RETURNING *`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        status: "error",
        message: "Student not found"
      });
    }

    res.json({
      status: "success",
      message: "Student deleted successfully",
      student: result.rows[0]
    });

  } catch (error) {
    console.error("Delete student error:", error);

    res.status(500).json({
      status: "error",
      message: "Failed to delete student"
    });
  }
});

//Create Conversation API
app.post("/api/conversations", async (req, res) => {
  try {
    const { student_id, subject, topic } = req.body;

    const result = await pool.query(
      `INSERT INTO conversations (student_id, subject, topic)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [student_id, subject, topic]
    );

    res.status(201).json({
      status: "success",
      message: "Conversation created successfully",
      conversation: result.rows[0]
    });

  } catch (error) {
    console.error("Create conversation error:", error);

    res.status(500).json({
      status: "error",
      message: "Failed to create conversation"
    });
  }
});

// Create Message API
app.post("/api/messages", async (req, res) => {
  try {
    const { conversation_id, role, content } = req.body;

const result = await pool.query(
  `INSERT INTO messages (conversation_id, role, content)
   VALUES ($1, $2, $3)
   RETURNING *`,
  [conversation_id,role, content]
);

    res.status(201).json({
      status: "success",
      message: "Message created successfully",
      data: result.rows[0]
    });

  } catch (error) {
    console.error("Create message error:", error);

    res.status(500).json({
      status: "error",
      message: "Failed to create message"
    });
  }
});


// Get Messages by Conversation ID
app.get("/api/conversations/:id/messages", async (req, res) => {
  try {
    const conversationId = Number(req.params.id);

    const result = await pool.query(
      `SELECT *
       FROM messages
       WHERE conversation_id = $1
       ORDER BY created_at ASC`,
      [conversationId]
    );

    res.status(200).json({
      status: "success",
      messages: result.rows
    });

  } catch (error) {
    console.error("Get messages error:", error);

    res.status(500).json({
      status: "error",
      message: "Failed to get messages"
    });
  }
});


// AI Reply API
app.post("/api/ai/reply", async (req, res) => {
  try {
    const { conversation_id, question } = req.body;

    // Temporary AI response
    const aiAnswer =
      "Fractions represent parts of a whole. For example, 1/2 means one out of two equal parts.";

    // Save AI response in messages table
    const result = await pool.query(
      `INSERT INTO messages (conversation_id, role, content)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [conversation_id, "assistant", aiAnswer]
    );

    res.status(201).json({
      status: "success",
      message: "AI reply created successfully",
      data: result.rows[0]
    });

  } catch (error) {
    console.error("AI reply error:", error);

    res.status(500).json({
      status: "error",
      message: "Failed to generate AI reply"
    });
  }
});

app.post("/api/auth/register", async (req, res) => {
  try {
    const user = await registerUser(req.body);

    return res.status(201).json({ user });
  } catch (error: unknown) {
    if (error instanceof ValidationError) {
      const validationError = error as ValidationError;
      return res.status(400).json({
        error: {
          code: validationError.code,
          message: validationError.message,
        },
      });
    }

    if (error instanceof DuplicateUserError) {
      const duplicateError = error as DuplicateUserError;
      return res.status(409).json({
        error: {
          code: duplicateError.code,
          message: duplicateError.message,
        },
      });
    }

    console.error("Registration error:", error);

    return res.status(500).json({
      error: {
        code: "INTERNAL_ERROR",
        message: "Failed to register user",
      },
    });
  }
});


const PORT = 3000;

app.listen(PORT, () => {
    console.log(`AI Teacher backend running on http://localhost:${PORT}`);
});