import { Navigate, Route, Routes } from "react-router-dom";
import { ProtectedRoute } from "../auth/ProtectedRoute";
import { RootLayout } from "../layouts/RootLayout";
import AiConversationPage from "../pages/AiConversationPage";
import AiTeacherPage from "../pages/AiTeacherPage";
import AttemptPage from "../pages/AttemptPage";
import ChapterDetailPage from "../pages/ChapterDetailPage";
import DashboardPage from "../pages/DashboardPage";
import LearningPage from "../pages/LearningPage";
import LoginPage from "../pages/LoginPage";
import NotFoundPage from "../pages/NotFoundPage";
import PracticeDetailPage from "../pages/PracticeDetailPage";
import PracticePage from "../pages/PracticePage";
import ProfilePage from "../pages/ProfilePage";
import ResultDetailPage from "../pages/ResultDetailPage";
import ResultsPage from "../pages/ResultsPage";
import SubjectContextPage from "../pages/SubjectContextPage";
import SubjectListPage from "../pages/SubjectListPage";
import TopicDetailPage from "../pages/TopicDetailPage";

/**
 * Application route table. Placeholder routes only — feature screens are
 * implemented in future UI slices.
 */
export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route element={<ProtectedRoute />}>
        <Route element={<RootLayout />}>
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/learning" element={<LearningPage />} />
          <Route path="/learning/:classId" element={<SubjectListPage />} />
          <Route
            path="/learning/:classId/subjects/:subjectId"
            element={<SubjectContextPage />}
          />
          <Route
            path="/learning/:classId/subjects/:subjectId/chapters/:chapterId"
            element={<ChapterDetailPage />}
          />
          <Route
            path="/learning/:classId/subjects/:subjectId/chapters/:chapterId/topics/:topicId"
            element={<TopicDetailPage />}
          />
          <Route path="/practice" element={<PracticePage />} />
          <Route
            path="/practice/:practiceId"
            element={<PracticeDetailPage />}
          />
          <Route
            path="/practice/:practiceId/attempt/:attemptId"
            element={<AttemptPage />}
          />
          <Route path="/results" element={<ResultsPage />} />
          <Route
            path="/results/:attemptId"
            element={<ResultDetailPage />}
          />
          <Route path="/ai-teacher" element={<AiTeacherPage />} />
          <Route
            path="/ai-teacher/:conversationId"
            element={<AiConversationPage />}
          />
          <Route path="/profile" element={<ProfilePage />} />
        </Route>
      </Route>

      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
