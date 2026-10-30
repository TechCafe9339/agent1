"use client";

import {
  ReactNode,
  useEffect,
  useState,
} from "react";

import {
  useRouter,
} from "next/navigation";

type AuthGuardProps = {
  children: ReactNode;
};

export default function AuthGuard({
  children,
}: AuthGuardProps) {
  const router = useRouter();

  const [checking, setChecking] =
    useState(true);

  useEffect(() => {
    const token =
      localStorage.getItem(
        "token"
      );

    if (!token) {
      router.replace(
        "/login"
      );

      return;
    }

    setChecking(false);
  }, [router]);

  if (checking) {
    return (
      <p className="muted">
        Checking authentication...
      </p>
    );
  }

  return (
    <>
      {children}
    </>
  );
}