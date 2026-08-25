# AI Teacher — GitHub Copilot Workspace Instructions

## Project
AI Teacher is a personalized AI learning and competitive-exam preparation SaaS platform with a ChatGPT-like experience. It serves students, teachers, parents, schools, and coaching centres.

Core loop:
**Student → Learn → Retrieve relevant content → AI teaches → Practice → Assessment → Analyze → Next task → Progress → Adapt**

Build incrementally. Preserve working functionality. Inspect the workspace before changing code.

## Stack
- Frontend: React + TypeScript
- Backend: Node.js + Express + TypeScript
- Database: PostgreSQL
- AI: model APIs + RAG
- Testing: unit/integration/API tests; Postman where useful
- Future mobile: React Native + TypeScript using the same backend APIs

Do not introduce another major framework/database without a clear reason.

## Architecture
- API-first and mobile-ready.
- Keep business logic in backend services, not React components.
- Separate routes/controllers, services, data access, AI/RAG, auth, validation, configuration and tests.
- Use environment variables for secrets and external configuration.
- Never expose AI API keys or database credentials to the frontend.
- Prefer small, maintainable modules over large “god” files.

## Roles
Student:
- learning, questions, practice, quizzes, tasks, schedules, progress, downloads

Teacher:
- classes, students, content, AI task review, plans, assessments, progress

Parent:
- permitted student progress and tasks

School Admin:
- users, classes, teachers, content access, analytics

Coaching Centre:
- batches, students, academy content, tests, personalized exam preparation

Use role-based authorization. Never rely only on frontend checks.

## Multi-tenancy
The platform must support multiple schools, coaching centres and individual users.

Every organization-owned resource must have appropriate tenant/organization ownership and authorization. Prevent cross-tenant access.

Conceptually:
- School A → teachers → classes → students → content
- School B → teachers → classes → students → content
- Coaching Centre A → batches → students → academy content
- Individual users

## Education Context
Support:
- School boards/curricula
- Class/level
- Subject/chapter/topic
- Homework, assignments, revision and practice
- Competitive exams such as TNPSC, NEET, JEE, UPSC, SSC, Banking, GATE, CAT and Railway exams

Keep exam configuration data-driven. Do not hard-code marks/patterns that may change. Use current official sources as the source of truth when implementing exam-specific functionality.

## Content and RAG
Support authorized:
- PDFs/textbooks
- Teacher notes
- Worksheets
- Assignments
- Question banks
- Previous-year questions
- Mock tests
- Exam material
- Official curriculum/syllabus material

Organizations should be able to use their own study material.

RAG flow:
**Document → extraction → cleaning → chunking → metadata → embeddings/index → retrieval → relevant context → AI response**

Useful metadata can include tenant, board, class, exam, subject, chapter, topic, language, source, version and approval status.

Prefer approved organization content for curriculum answers. Do not send entire textbooks to the model unnecessarily.

## AI Teacher
Eventually support:
- Concept explanations
- Examples and step-by-step solutions
- Practice questions
- Quizzes/tests
- Revision
- Study planning
- AI-generated tasks
- Performance analysis
- Weak-topic identification
- Personalized recommendations
- Downloadable learning documents

Use student context such as class, subject, board/exam, language, history, performance, weak areas, pending tasks and goals where appropriate.

Do not expose system prompts, secrets or private organization content.

## Tasks and Scheduling
AI may create tasks such as:
- Mathematics — Complete Algebra Exercise 1
- Science — Revise Electricity
- Social Science — Complete assigned chapter task

Consider syllabus, pending work, performance, weak topics, exams and available study time.

Task states may include:
- Planned
- Pending
- In progress
- Completed
- Skipped
- Rescheduled

Avoid uncontrolled autonomous task creation.

## Adaptive Learning
Use:
**Study → Practice → Test → Analyze mistakes → Identify weak topic → Remedial task → Retest → Update plan**

Recommendations should be understandable to teachers/students.

## Assessment
Eventually support:
- MCQs
- Descriptive questions
- Topic tests
- Timed tests
- Mock exams
- Scoring where reliable
- Answer explanations
- Mistake analysis
- Weak-topic detection
- Progress history

For high-stakes contexts, AI scoring is learning feedback unless validated to an appropriate standard.

## Tamil and Indian Languages
Planned:
- English
- Tamil
- Hindi
- Malayalam
- Kannada
- Telugu and others later

Tamil is a strategic priority. Do not treat Tamil as word-for-word translation. Aim for natural, age-appropriate, subject-correct and exam-appropriate Tamil. Support mixed Tamil/English questions.

Potential future Tamil capabilities:
- Tamil question generation
- Tamil explanations
- Tamil revision material
- TNPSC preparation
- Tamil handwriting evaluation

## Handwritten Answers — Future
Potential flow:
**Photo → handwriting/OCR → extracted answer → rubric evaluation → score + feedback → follow-up practice**

Handle OCR uncertainty. Consider poor handwriting, lighting, angle, cross-outs, diagrams, mathematical notation and Tamil handwriting. Do not claim official marking.

## Downloadable Documents
Eventually generate:
- Concept summaries
- Chapter summaries
- Quick revision notes
- Formula sheets
- Important-point sheets
- Practice sheets
- Answer keys
- Mock tests
- Weak-topic reports
- Personalized study plans

Personalize by class/exam, subject, language, difficulty and learning gaps.

## Teacher Control
Principle:
**AI recommends → Teacher controls → Student executes**

Teachers should be able to review/modify/approve AI-generated tasks and plans.

## Voice, Images and Video
Images: diagrams and visual explanations.

Voice:
**speech-to-text → AI → text-to-speech**

Video is later-stage: scripts, visuals, narration, subtitles and short personalized lessons. Do not add complex video infrastructure prematurely.

## AI Cost and SaaS Economics
This is a core requirement because schools may have 1,000+ students.

Track where possible:
- AI requests
- tokens/usage
- model
- estimated cost
- student
- organization
- feature
- time period

Use cost-appropriate models. Use RAG and caching where safe. Use quotas/plan allowances to prevent uncontrolled expensive usage.

Commercial principle:
**Revenue per customer/student must sustainably exceed AI + infrastructure + payment + support costs.**

AI-related features must consider usage/cost impact.

## Security
Treat security as first-class:
- Authentication
- Authorization
- Tenant isolation
- Input validation
- Rate limiting
- File-upload validation/access control
- Secure password/token handling
- SQL injection prevention
- XSS/CSRF considerations
- Safe secrets management
- Appropriate logging

Never log API keys, passwords, tokens or unnecessary sensitive student data.

## Database
Use PostgreSQL and migrations.

Potential entities include users, roles, organizations, classes, batches, students, subjects, boards, exams, syllabi, chapters, topics, content sources, documents, chunks, questions, quizzes, attempts, tasks, study plans, progress, learning events, subscriptions and usage records.

Do not create all future tables now. Create what the current feature needs while keeping it extensible. Never manually alter production schemas without migrations.

## APIs
Use consistent REST patterns:
- Clear resource naming
- Correct HTTP methods/status codes
- Validation
- Auth/authorization middleware
- Centralized error handling
- Pagination for large lists
- Filtering/sorting where useful
- Rate limits for sensitive/high-cost endpoints

Do not expose internal database structures unnecessarily.

Existing diagnostic concepts:
- `/api/health` — backend health
- `/api/db-test` — PostgreSQL connectivity

## Testing / QA
The developer has a QA background. Make features testable.

For meaningful features include:
- Happy path
- Validation failures
- Unauthorized/forbidden access
- Not found
- Boundary cases
- Duplicate requests
- Empty input
- External service failures
- Tenant-isolation tests

For AI features, test input construction, retrieved context, output schema validation, fallback behavior and usage/cost recording.

Do not rely on exact AI wording for deterministic tests.

## Frontend
Use reusable React components and typed API interfaces.

Avoid:
- Business logic inside JSX
- Hard-coded URLs/secrets
- Large components
- Duplicated API calls
- Uncontrolled global state

Provide:
- Loading states
- Error states
- Empty states
- Accessible forms
- Responsive/mobile-friendly UI

## Content / Copyright
Only use content that is owned, licensed, authorized, public-domain or otherwise permitted. Preserve source/ownership metadata where practical. Do not implement unauthorized scraping or redistribution.

## Observability
As the system grows, support structured logging, request IDs, latency, AI usage/cost, error rates, database performance and background-job status. Avoid collecting unnecessary personal data.

## Scalability
Build:
**prototype → pilot → hundreds of students → 1,000+ student school → multiple organizations → larger SaaS**

Do not prematurely build distributed complexity. Keep modules simple and extensible.

## Environment
Use:
- local/development
- test/staging
- production

Never commit `.env`, credentials, keys or certificates. Maintain `.env.example`.

## Coding Style
Prefer:
- Strict TypeScript
- Meaningful names
- Small functions
- Explicit public types
- Reusable modules
- Early validation
- Clear errors
- Minimal duplication

Avoid unjustified `any`, dead code, unused dependencies, magic numbers and hard-coded configuration.

Follow the project's configured formatter/linter.

## Dependency Discipline
Before adding a package, inspect existing dependencies. Prefer mature, maintained packages and avoid unnecessary dependencies. Consider licensing.

## Git
Keep changes focused and avoid unrelated refactoring. Prefer small commits such as:
- `feat: add student registration API`
- `test: add registration validation`
- `fix: handle duplicate student email`

## Development Priorities
1. Core web app
2. Authentication and roles
3. Student/class/subject context
4. Syllabus
5. AI chat
6. Content upload
7. RAG
8. English + Tamil
9. Quizzes/assessment
10. AI-generated tasks
11. Scheduling
12. Progress/adaptive learning
13. Downloadable documents
14. Teacher dashboard
15. Multi-tenancy
16. Subscriptions + usage/cost
17. Competitive exams
18. Voice
19. Handwritten answers
20. Video
21. Mobile app

Do not implement later-stage features before the core learning loop is stable unless explicitly requested.

## Definition of Done
A feature is complete only when:
- Requirements are implemented
- API contracts are clear
- Validation exists
- Authorization exists
- Tenant isolation is correct where applicable
- Errors are handled
- Tests cover important paths
- UI has appropriate loading/error/empty states
- Secrets are protected
- AI usage/cost is tracked where applicable
- Existing tests still pass
- Documentation/setup is updated when necessary

## Copilot Execution Rules
When asked to implement a feature:
1. Inspect the workspace first.
2. Identify existing architecture and conventions.
3. Reuse existing patterns.
4. Briefly state the implementation plan.
5. Make the smallest coherent change.
6. Add/update tests.
7. Check security, authorization, validation and tenant isolation.
8. Check AI usage/cost implications.
9. Never invent existing files/APIs/tables/configuration.
10. Avoid unrelated changes.
11. Report changed files and recommended tests.

If requirements are ambiguous and the ambiguity could cause a major architectural decision, ask for clarification instead of silently choosing.
