"use client";

import {
  FormEvent,
  useState,
} from "react";

import Link from "next/link";

type RegisterResponse = {
  message: string;
  token: string;
  user: {
    id: number;
    email: string;
  };
};

export default function RegisterPage() {
  const [email, setEmail] =
    useState("");

  const [password, setPassword] =
    useState("");

  const [
    confirmPassword,
    setConfirmPassword,
  ] = useState("");

  const [error, setError] =
    useState<string | null>(null);

  const [loading, setLoading] =
    useState(false);

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    setError(null);

    if (
      password !==
      confirmPassword
    ) {
      setError(
        "Passwords do not match."
      );

      return;
    }

    if (
      password.length < 8
    ) {
      setError(
        "Password must be at least 8 characters."
      );

      return;
    }

    setLoading(true);

    try {
      const response = await fetch(
        "http://localhost:5000/api/auth/register",
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json",
          },

          body: JSON.stringify({
            email,
            password,
          }),
        }
      );

      const data =
        (await response.json()) as
          | RegisterResponse
          | { error?: string };

      if (!response.ok) {
        throw new Error(
          "error" in data &&
            data.error
            ? data.error
            : "Registration failed"
        );
      }

      const registerData =
        data as RegisterResponse;

      localStorage.setItem(
        "token",
        registerData.token
      );

      localStorage.setItem(
        "user",
        JSON.stringify(
          registerData.user
        )
      );

      window.location.href =
        "/dashboard";

    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Registration failed"
      );

    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-wrapper">
        <div className="auth-side">
          <div>
            <span className="auth-badge">
              Start your journey
            </span>

            <h1>
              Build better financial habits.
            </h1>

            <p>
              Create your account and
              start tracking your income,
              spending, budgets and progress.
            </p>
          </div>

          <div className="auth-side-footer">
            Your financial overview,
            all in one place.
          </div>
        </div>

        <div className="auth-form-section">
          <div className="auth-form-card">
            <div className="auth-heading">
              <h2>
                Create account
              </h2>

              <p>
                Set up your finance
                workspace in a few seconds.
              </p>
            </div>

            <form
              onSubmit={handleSubmit}
              className="auth-form"
            >
              <div className="auth-field">
                <label htmlFor="email">
                  Email address
                </label>

                <input
                  id="email"
                  className="form-control"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(event) =>
                    setEmail(
                      event.target.value
                    )
                  }
                  required
                />
              </div>

              <div className="auth-field">
                <label htmlFor="password">
                  Password
                </label>

                <input
                  id="password"
                  className="form-control"
                  type="password"
                  placeholder="Minimum 8 characters"
                  value={password}
                  onChange={(event) =>
                    setPassword(
                      event.target.value
                    )
                  }
                  minLength={8}
                  required
                />
              </div>

              <div className="auth-field">
                <label htmlFor="confirmPassword">
                  Confirm password
                </label>

                <input
                  id="confirmPassword"
                  className="form-control"
                  type="password"
                  placeholder="Enter password again"
                  value={confirmPassword}
                  onChange={(event) =>
                    setConfirmPassword(
                      event.target.value
                    )
                  }
                  required
                />
              </div>

              {error && (
                <div className="auth-error">
                  {error}
                </div>
              )}

              <button
                className="btn btn-primary auth-submit"
                type="submit"
                disabled={loading}
              >
                {loading
                  ? "Creating account..."
                  : "Create Account"}
              </button>
            </form>

            <p className="auth-switch">
              Already have an account?
              {" "}

              <Link href="/login">
                Sign in
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}