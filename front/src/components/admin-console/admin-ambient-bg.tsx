"use client";

import { useRef } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";

/** 全屏流光背景（GSAP 驱动） */
export function AdminAmbientBackground() {
  const rootRef = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      gsap.to("[data-orb='a']", {
        x: 120,
        y: 80,
        duration: 9,
        repeat: -1,
        yoyo: true,
        ease: "sine.inOut",
      });
      gsap.to("[data-orb='b']", {
        x: -100,
        y: -60,
        duration: 11,
        repeat: -1,
        yoyo: true,
        ease: "sine.inOut",
      });
      gsap.to("[data-orb='c']", {
        x: 60,
        y: -90,
        scale: 1.25,
        duration: 7,
        repeat: -1,
        yoyo: true,
        ease: "sine.inOut",
      });
      gsap.to("[data-orb='d']", {
        opacity: 0.55,
        duration: 4,
        repeat: -1,
        yoyo: true,
        ease: "sine.inOut",
      });
      gsap.to("[data-scanline]", {
        backgroundPosition: "0% 200%",
        duration: 12,
        repeat: -1,
        ease: "none",
      });
    },
    { scope: rootRef }
  );

  return (
    <div ref={rootRef} className="fixed inset-0 overflow-hidden pointer-events-none z-0">
      <div className="absolute inset-0 bg-[#030712]" />
      <div
        data-orb="a"
        className="absolute -top-24 -left-24 h-[420px] w-[420px] rounded-full bg-cyan-500/25 blur-[100px]"
      />
      <div
        data-orb="b"
        className="absolute top-1/3 -right-32 h-[380px] w-[380px] rounded-full bg-violet-600/30 blur-[90px]"
      />
      <div
        data-orb="c"
        className="absolute -bottom-32 left-1/4 h-[360px] w-[360px] rounded-full bg-fuchsia-500/20 blur-[95px]"
      />
      <div
        data-orb="d"
        className="absolute top-1/2 left-1/2 h-[280px] w-[280px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-sky-400/15 blur-[80px] opacity-30"
      />
      <div
        className="absolute inset-0 opacity-[0.07]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(125,211,252,0.8) 1px, transparent 1px), linear-gradient(90deg, rgba(125,211,252,0.8) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
        }}
      />
      <div
        data-scanline
        className="absolute inset-0 opacity-[0.04]"
        style={{
          backgroundImage:
            "linear-gradient(180deg, transparent 0%, rgba(255,255,255,0.9) 50%, transparent 100%)",
          backgroundSize: "100% 200%",
        }}
      />
    </div>
  );
}
