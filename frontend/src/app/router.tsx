import { Navigate, Route, Routes } from "react-router-dom";
import { ProtectedRoute } from "../auth/ProtectedRoute";
import { RootLayout } from "../layouts/RootLayout";
import AiTeacherPage from "../pages/AiTeacherPage";
import DashboardPage from "../pages/DashboardPage";
import LearningPage from "../pages/LearningPage";
import LoginPage from "../pages/LoginPage";
import NotFoundPage from "../pages/NotFoundPage";
import PracticePage from "../pages/PracticePage";
import ProfilePage from "../pages/ProfilePage";
import ResultsPage from "../pages/ResultsPage";
import SubjectContextPage from "../pages/SubjectContextPage";
import SubjectListPage from "../pages/SubjectListPage";

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
          <Route path="/practice" element={<PracticePage />} />
          <Route path="/results" element={<ResultsPage />} />
          <Route path="/ai-teacher" element={<AiTeacherPage />} />
          <Route path="/profile" element={<ProfilePage />} />
        </Route>
      </Route>

      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
