import { useNavigate } from "react-router-dom";
import { Container } from "../components/Container";
import { Button } from "../components/ui/Button";

export default function NotFoundPage() {
  const navigate = useNavigate();

  return (
    <Container className="py-20 text-center">
      <h1 className="page-title">Page not found</h1>
      <p className="secondary mt-2">
        The page you’re looking for doesn’t exist.
      </p>
      <div className="mt-6">
        <Button onClick={() => navigate("/")}>Go to home</Button>
      </div>
    </Container>
  );
}
