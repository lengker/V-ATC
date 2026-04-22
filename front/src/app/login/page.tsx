"use client";

import { Suspense } from "react";
import { Component } from "@/components/ui/animated-characters-login-page";

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen grid place-items-center text-sm text-muted-foreground">Loading login...</div>}>
      <Component />
    </Suspense>
  );
}

