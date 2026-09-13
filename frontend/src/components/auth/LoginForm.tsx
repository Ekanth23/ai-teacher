import { useState, type FormEvent } from "react";
import { Button } from "../ui/Button";
import { Field, Input } from "../ui/Input";

export interface LoginFormValues {
  identifier: string;
  password: string;
}

export interface LoginFormProps {
  loading?: boolean;
  error?: string | null;
  onSubmit: (values: LoginFormValues) => void;
}

interface FieldErrors {
  identifier?: string;
  password?: string;
}

export function LoginForm({
  loading = false,
  error,
  onSubmit,
}: LoginFormProps) {
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const next: FieldErrors = {};
    if (!identifier.trim()) {
      next.identifier = "Enter your email or phone.";
    }
    if (!password) {
      next.password = "Enter your password.";
    }
    setFieldErrors(next);

    if (next.identifier || next.password) {
      return;
    }

    onSubmit({ identifier: identifier.trim(), password });
  };

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
      <Field label="Email or phone" error={fieldErrors.identifier}>
        <Input
          name="identifier"
          type="text"
          autoComplete="username"
          placeholder="you@example.com"
          value={identifier}
          onChange={(event) => setIdentifier(event.target.value)}
          invalid={Boolean(fieldErrors.identifier)}
          disabled={loading}
        />
      </Field>

      <Field label="Password" error={fieldErrors.password}>
        <Input
          name="password"
          type="password"
          autoComplete="current-password"
          placeholder="••••••••"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          invalid={Boolean(fieldErrors.password)}
          disabled={loading}
        />
      </Field>

      {error ? (
        <p role="alert" className="text-sm text-error">
          {error}
        </p>
      ) : null}

      <Button type="submit" loading={loading} className="w-full">
        Sign in
      </Button>
    </form>
  );
}
