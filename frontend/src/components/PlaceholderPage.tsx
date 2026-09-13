import { Container } from "./Container";
import { PageHeader } from "./PageHeader";

export interface PlaceholderPageProps {
  title: string;
}

/**
 * Temporary placeholder for a route that will be implemented in a future UI
 * slice. Keeps the application architecture navigable without fabricating
 * feature content.
 */
export function PlaceholderPage({ title }: PlaceholderPageProps) {
  return (
    <Container className="py-10">
      <PageHeader title={title} description="Coming in the next UI slice." />
    </Container>
  );
}
