"use client";

import {
  FormEvent,
  useState,
} from "react";

import Link from "next/link";
import { useRouter } from "next/navigation";

type LoginResponse = {
  message: string;
  token: string;
  user: {
    id: number;
    email: string;
  };
};

export default function LoginPage() {
  const router = useRouter();

  const [email, setEmail] =
    useState("");

  const [password, setPassword] =
    useState("");

  const [error, setError] =
    useState<string | null>(null);

  const [loading, setLoading] =
    useState(false);

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    setError(null);
    setLoading(true);

    try {
      const response = await fetch(
        "http://localhost:5000/api/auth/login",
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
          | LoginResponse
          | { error?: string };

      if (!response.ok) {
        throw new Error(
          "error" in data &&
            data.error
            ? data.error
            : "Login failed"
        );
      }

      const loginData =
        data as LoginResponse;

      localStorage.setItem(
        "token",
        loginData.token
      );

      localStorage.setItem(
        "user",
        JSON.stringify(
          loginData.user
        )
      );

      window.location.href =
        "/dashboard";

    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Login failed"
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
              Personal Finance
            </span>

            <h1>
              Take control of your money.
            </h1>

            <p>
              Track income, expenses,
              budgets and financial insights
              from one simple dashboard.
            </p>
          </div>

          <div className="auth-side-footer">
            Smart finance management,
            made simple.
          </div>
        </div>

        <div className="auth-form-section">
          <div className="auth-form-card">
            <div className="auth-heading">
              <h2>
                Welcome back
              </h2>

              <p>
                Sign in to continue to
                your dashboard.
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
                  placeholder="Enter your password"
                  value={password}
                  onChange={(event) =>
                    setPassword(
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
                  ? "Signing in..."
                  : "Sign In"}
              </button>
            </form>

            <p className="auth-switch">
              Don&apos;t have an account?
              {" "}

              <Link href="/register">
                Create account
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}