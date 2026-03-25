"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Eye, EyeOff, Mail } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/hooks/use-toast";

function Characters({
  focus,
  emailLength,
  passwordLength,
}: {
  focus: "email" | "password" | null;
  emailLength: number;
  passwordLength: number;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [mouse, setMouse] = useState({ x: 0, y: 0, active: false });
  const [hovered, setHovered] = useState<"purple" | "black" | "orange" | "yellow" | null>(null);
  const [nudge, setNudge] = useState({ x: 0, y: 0, r: 0 });
  const [crazy, setCrazy] = useState(false);
  const [crazyJitter, setCrazyJitter] = useState({ x: 0, y: 0, r: 0 });

  const blinkClass = "animate-[blink_4s_infinite]";
  const lookLeft = focus === "email";
  const lookRight = focus === "password";

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const nx = (e.clientX - rect.left) / rect.width; // 0..1
      const ny = (e.clientY - rect.top) / rect.height; // 0..1
      setMouse({
        x: Math.max(0, Math.min(1, nx)),
        y: Math.max(0, Math.min(1, ny)),
        active: true,
      });
    };
    const onLeave = () => setMouse((m) => ({ ...m, active: false }));
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseleave", onLeave);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseleave", onLeave);
    };
  }, []);

  // 物理衰减：点击后弹飞逐渐回位
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      setNudge((prev) => ({
        x: Math.abs(prev.x) < 0.1 ? 0 : prev.x * 0.88,
        y: Math.abs(prev.y) < 0.1 ? 0 : prev.y * 0.88,
        r: Math.abs(prev.r) < 0.08 ? 0 : prev.r * 0.86,
      }));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // 狂暴模式：持续抖动
  useEffect(() => {
    if (!crazy) {
      setCrazyJitter({ x: 0, y: 0, r: 0 });
      return;
    }
    const id = setInterval(() => {
      setCrazyJitter({
        x: (Math.random() - 0.5) * 12,
        y: (Math.random() - 0.5) * 10,
        r: (Math.random() - 0.5) * 6,
      });
    }, 60);
    return () => clearInterval(id);
  }, [crazy]);

  const gazeX = lookLeft
    ? -1
    : lookRight
      ? 1
      : mouse.active
        ? (mouse.x - 0.5) * 2 // -1..1
        : 0;
  const gazeY = mouse.active ? (mouse.y - 0.5) * 2 : 0;
  const eyeBallTx = Math.round(gazeX * 1.8) + (focus ? 1 : 0);
  const eyeBallTy = Math.round(gazeY * 1.1) + (focus ? -1 : 0);
  const eyeTx = Math.round(gazeX * 6.8) + (focus ? 1 : 0);
  const eyeTy = Math.round(gazeY * 4.2) + (focus ? -1 : 0);

  const sceneTx = (mouse.active ? (mouse.x - 0.5) * 18 : 0) + nudge.x + crazyJitter.x;
  const sceneTy = (mouse.active ? (mouse.y - 0.5) * 14 : 0) + nudge.y + crazyJitter.y;
  const sceneRot = (mouse.active ? (mouse.x - 0.5) * 5.5 : 0) + nudge.r + crazyJitter.r;

  // 偷看模式：输入框聚焦时，角色整体探头到右侧边框附近
  const sneaking = focus === "email" || focus === "password";
  const sneakX = focus === "email" ? 138 : focus === "password" ? 158 : 0;
  const sneakY = sneaking ? -16 : 0;
  const sneakRot = focus === "email" ? 7 : focus === "password" ? 11 : 0;
  const sneakScale = sneaking ? 1.04 : 1;
  const curious = sneaking;

  const poke = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = (e.clientX - cx) / (rect.width / 2);
    const dy = (e.clientY - cy) / (rect.height / 2);
    setNudge((prev) => ({
      x: prev.x + dx * 20,
      y: prev.y + dy * 16,
      r: prev.r + dx * 7,
    }));
  };

  const charFx = (id: "purple" | "black" | "orange" | "yellow") => {
    const on = hovered === id;
    return on
      ? "scale(1.08) rotate(-2deg) translateY(-8px)"
      : "scale(1) rotate(0deg) translateY(0)";
  };
  const emailPeek = focus === "email";
  const peekLevel = Math.min(1, emailLength / 18);
  const purpleExtraY = emailPeek ? 8 + Math.round(peekLevel * 12) : 0;
  const purpleSkew = emailPeek ? -6 - peekLevel * 6 : 0;
  const purpleScale = emailPeek ? 1.02 + peekLevel * 0.03 : 1;

  void passwordLength;

  return (
    <div
      ref={containerRef}
      className="relative h-[430px] w-full cursor-pointer select-none"
      onClick={poke}
      onDoubleClick={() => setCrazy((v) => !v)}
      title={crazy ? "Crazy mode ON (double click to off)" : "Double click to toggle crazy mode"}
    >
      <style jsx>{`
        @keyframes blink {
          0%, 96%, 100% { transform: scaleY(1); }
          98% { transform: scaleY(0.15); }
        }
        @keyframes bobA {
          0%, 100% { transform: translateY(0px) scaleY(1) scaleX(1); }
          25% { transform: translateY(-14px) scaleY(1.03) scaleX(0.98); }
          50% { transform: translateY(0px) scaleY(0.96) scaleX(1.04); }
          75% { transform: translateY(-8px) scaleY(1.02) scaleX(0.99); }
        }
        @keyframes bobB {
          0%, 100% { transform: translateY(0px) scaleY(1) scaleX(1); }
          30% { transform: translateY(-18px) scaleY(1.05) scaleX(0.97); }
          55% { transform: translateY(0px) scaleY(0.95) scaleX(1.05); }
          80% { transform: translateY(-10px) scaleY(1.02) scaleX(0.99); }
        }
        @keyframes bobC {
          0%, 100% { transform: translateY(0px) scaleY(1) scaleX(1); }
          20% { transform: translateY(-9px) scaleY(1.02) scaleX(0.99); }
          45% { transform: translateY(0px) scaleY(0.97) scaleX(1.03); }
          70% { transform: translateY(-6px) scaleY(1.01) scaleX(1); }
        }
        @keyframes shadowPulse {
          0%, 100% { transform: scaleX(1); opacity: 0.32; }
          50% { transform: scaleX(0.86); opacity: 0.18; }
        }
      `}</style>

      <div
        className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[520px] h-[320px] transition-transform duration-300 ease-out"
        style={{
          transform: `translate(-50%, 0) translate(${sceneTx + sneakX}px, ${sceneTy + sneakY}px) rotate(${sceneRot + sneakRot}deg) scale(${sneakScale})`,
        }}
      >
        {/* Ground shadows to enhance standing/bouncing effect */}
        <div
          className="absolute left-8 bottom-0 h-4 w-[270px] rounded-full bg-black/30 blur-[2px]"
          style={{ animation: "shadowPulse 3.4s ease-in-out infinite" }}
        />
        <div
          className="absolute right-8 bottom-0 h-4 w-[160px] rounded-full bg-black/30 blur-[2px]"
          style={{ animation: "shadowPulse 3.9s ease-in-out infinite 0.35s" }}
        />

        {/* Purple */}
        <div
          className="absolute left-12 bottom-20 origin-bottom transition-transform duration-150"
          onMouseEnter={() => setHovered("purple")}
          onMouseLeave={() => setHovered(null)}
          style={{ transform: `${charFx("purple")} ${sneaking ? "translateX(8px)" : ""}` }}
        >
          <div
            className="h-64 w-48 rounded-t-2xl bg-gradient-to-b from-violet-500 to-violet-600 origin-bottom"
            style={{
              animation: "bobA 3.2s cubic-bezier(.45,.05,.55,.95) infinite",
              transform: `translateY(-${purpleExtraY}px) skewX(${purpleSkew}deg) scale(${purpleScale})`,
              transition: "transform 220ms ease",
            }}
          >
          <div className="absolute top-12 left-10 flex gap-8">
            <div
              className={`h-6 w-6 rounded-full bg-white ${blinkClass} transition-transform duration-100`}
              style={{ transform: `translate(${eyeBallTx}px, ${eyeBallTy}px)` }}
            >
              <div
                className="h-3 w-3 rounded-full bg-slate-800 mt-1.5 ml-1.5 transition-transform duration-100"
                style={{ transform: `translate(${eyeTx}px, ${eyeTy}px)` }}
              />
            </div>
            <div
              className={`h-6 w-6 rounded-full bg-white ${blinkClass} transition-transform duration-100`}
              style={{ transform: `translate(${eyeBallTx}px, ${eyeBallTy}px)` }}
            >
              <div
                className="h-3 w-3 rounded-full bg-slate-800 mt-1.5 ml-1.5 transition-transform duration-100"
                style={{ transform: `translate(${eyeTx}px, ${eyeTy}px)` }}
              />
            </div>
          </div>
          <div
            className="absolute top-[102px] left-16 h-2 rounded-full bg-violet-950/70 transition-all duration-200"
            style={{
              width: curious ? 46 : 28,
              transform: curious
                ? `translateX(${eyeBallTx * 0.4}px) scaleY(1.25)`
                : "translateX(0) scaleY(1)",
              borderRadius: focus === "password" ? 2 : 9999,
            }}
          />
          </div>
        </div>

        {/* Black */}
        <div
          className="absolute left-[200px] bottom-20 origin-bottom transition-transform duration-150"
          onMouseEnter={() => setHovered("black")}
          onMouseLeave={() => setHovered(null)}
          style={{ transform: `${charFx("black")} ${sneaking ? "translateX(14px) translateY(-4px)" : ""}` }}
        >
          <div
            className="h-[200px] w-32 rounded-t-xl bg-zinc-800 origin-bottom"
            style={{ animation: "bobB 3.8s cubic-bezier(.45,.05,.55,.95) infinite 0.15s" }}
          >
          <div className="absolute top-8 left-4 flex gap-6">
            <div
              className={`h-6 w-6 rounded-full bg-white ${blinkClass} transition-transform duration-100`}
              style={{ transform: `translate(${eyeBallTx}px, ${eyeBallTy}px)` }}
            >
              <div
                className="h-3 w-3 rounded-full bg-zinc-700 mt-1.5 ml-1.5 transition-transform duration-100"
                style={{ transform: `translate(${eyeTx}px, ${eyeTy}px)` }}
              />
            </div>
            <div
              className={`h-6 w-6 rounded-full bg-white ${blinkClass} transition-transform duration-100`}
              style={{ transform: `translate(${eyeBallTx}px, ${eyeBallTy}px)` }}
            >
              <div
                className="h-3 w-3 rounded-full bg-zinc-700 mt-1.5 ml-1.5 transition-transform duration-100"
                style={{ transform: `translate(${eyeTx}px, ${eyeTy}px)` }}
              />
            </div>
          </div>
          <div
            className="absolute top-[66px] left-[34px] rounded-full bg-zinc-600 transition-all duration-200"
            style={{
              width: focus === "password" ? 22 : 30,
              height: focus === "password" ? 22 : 6,
              transform: focus === "password"
                ? `translate(${eyeBallTx * 0.6}px, 6px)`
                : `translate(${eyeBallTx * 0.3}px, 0px)`,
            }}
          />
          {/* intentionally removed遮眼横线，避免视觉像“头上多了一道线” */}
          </div>
        </div>

        {/* Orange */}
        <div
          className="absolute left-0 bottom-0 origin-bottom transition-transform duration-150"
          onMouseEnter={() => setHovered("orange")}
          onMouseLeave={() => setHovered(null)}
          style={{ transform: charFx("orange") }}
        >
          <div
            className="h-48 w-[272px] rounded-[120px_120px_0_0] bg-orange-400 origin-bottom"
            style={{ animation: "bobC 3.5s cubic-bezier(.45,.05,.55,.95) infinite 0.25s" }}
          >
          <div className="absolute top-[88px] left-20 flex gap-9">
            <div
              className={`h-6 w-6 rounded-full bg-slate-800 ${blinkClass} transition-transform duration-100`}
              style={{ transform: `translate(${eyeBallTx}px, ${eyeBallTy}px)` }}
            >
              <div
                className="h-2.5 w-2.5 rounded-full bg-black/70 mt-[7px] ml-[7px] transition-transform duration-100"
                style={{ transform: `translate(${eyeTx}px, ${eyeTy}px)` }}
              />
            </div>
            <div
              className={`h-6 w-6 rounded-full bg-slate-800 ${blinkClass} transition-transform duration-100`}
              style={{ transform: `translate(${eyeBallTx}px, ${eyeBallTy}px)` }}
            >
              <div
                className="h-2.5 w-2.5 rounded-full bg-black/70 mt-[7px] ml-[7px] transition-transform duration-100"
                style={{ transform: `translate(${eyeTx}px, ${eyeTy}px)` }}
              />
            </div>
          </div>
          <div
            className="absolute left-[96px] bg-slate-800 transition-all duration-200"
            style={{
              top: focus === "email" ? 126 : 136,
              width: focus === "email" ? 42 : 56,
              height: focus === "email" ? 14 : 8,
              borderRadius: focus === "email" ? 9999 : 8,
              transform: `translateX(${eyeBallTx * 0.4}px)`,
            }}
          />
          </div>
        </div>

        {/* Yellow */}
        <div
          className="absolute right-10 bottom-0 origin-bottom transition-transform duration-150"
          onMouseEnter={() => setHovered("yellow")}
          onMouseLeave={() => setHovered(null)}
          style={{ transform: `${charFx("yellow")} ${sneaking ? "translateX(18px) translateY(-6px) rotate(2deg)" : ""}` }}
        >
          <div
            className="h-56 w-40 rounded-[120px_120px_0_0] bg-yellow-400 origin-bottom"
            style={{ animation: "bobA 4.1s cubic-bezier(.45,.05,.55,.95) infinite 0.4s" }}
          >
          <div className="absolute top-16 left-11 flex gap-8">
            <div
              className={`h-5 w-5 rounded-full bg-slate-800 ${blinkClass} transition-transform duration-100`}
              style={{ transform: `translate(${eyeBallTx}px, ${eyeBallTy}px)` }}
            >
              <div
                className="h-2 w-2 rounded-full bg-black/70 mt-[6px] ml-[6px] transition-transform duration-100"
                style={{ transform: `translate(${eyeTx}px, ${eyeTy}px)` }}
              />
            </div>
            <div
              className={`h-5 w-5 rounded-full bg-slate-800 ${blinkClass} transition-transform duration-100`}
              style={{ transform: `translate(${eyeBallTx}px, ${eyeBallTy}px)` }}
            >
              <div
                className="h-2 w-2 rounded-full bg-black/70 mt-[6px] ml-[6px] transition-transform duration-100"
                style={{ transform: `translate(${eyeTx}px, ${eyeTy}px)` }}
              />
            </div>
          </div>
          <div
            className="absolute left-10 bg-slate-700 transition-all duration-200"
            style={{
              top: focus === "password" ? 112 : 120,
              width: focus === "password" ? 30 : 96,
              height: focus === "password" ? 16 : 8,
              borderRadius: focus === "password" ? 9999 : 8,
              transform: `translateX(${eyeBallTx * 0.55}px) rotate(${focus === "password" ? 8 : 0}deg)`,
            }}
          />
          </div>
        </div>
      </div>

      {crazy ? (
        <div className="absolute top-2 right-2 text-[10px] px-2 py-1 rounded-full bg-pink-500/90 text-white font-semibold">
          CRAZY MODE
        </div>
      ) : null}
    </div>
  );
}

export function Component() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") || "/";
  const { login } = useAuth();
  const { toast } = useToast();

  const [email, setEmail] = useState("anna@gmail.com");
  const [password, setPassword] = useState("12345678");
  const [remember, setRemember] = useState(true);
  const [showPwd, setShowPwd] = useState(false);
  const [focus, setFocus] = useState<"email" | "password" | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorText, setErrorText] = useState("");
  const valid = useMemo(() => /\S+@\S+\.\S+/.test(email) && password.length >= 6, [email, password]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    setLoading(true);
    setErrorText("");
    const res = await login({ email, password });
    if (!res.ok) {
      setErrorText(res.error);
      toast({ title: "登录失败", description: res.error, variant: "destructive" });
      setLoading(false);
      return;
    }
    if (!remember) {
      try {
        // 不记住时，当前页仍可进入；刷新后需要重新登录
        sessionStorage.setItem("alpha.temp.login", "1");
      } catch {
        // ignore
      }
    }
    toast({ title: "登录成功", description: "欢迎进入系统" });
    router.replace(next);
  };

  return (
    <div className="min-h-screen grid md:grid-cols-2 bg-background">
      {/* Left */}
      <div className="relative hidden md:flex flex-col justify-between p-10 bg-[radial-gradient(circle_at_20%_20%,rgba(99,102,241,0.25),transparent_30%),radial-gradient(circle_at_80%_30%,rgba(56,189,248,0.2),transparent_35%),linear-gradient(135deg,#0f172a_0%,#111827_45%,#1f2937_100%)] text-white overflow-hidden">
        <div className="relative z-10 flex items-center gap-3">
          <div className="h-9 w-9 rounded-xl bg-white/10 border border-white/20 flex items-center justify-center">
            <Mail className="h-4 w-4" />
          </div>
          <div className="text-3xl font-bold">YourBrand</div>
        </div>

        <div className="relative z-10">
          <Characters focus={focus} emailLength={email.length} passwordLength={password.length} />
        </div>

        <div className="relative z-10 flex items-center gap-8 text-zinc-300 text-sm">
          <Link href="#" className="hover:text-white transition-colors">
            Privacy Policy
          </Link>
          <Link href="#" className="hover:text-white transition-colors">
            Terms of Service
          </Link>
          <Link href="#" className="hover:text-white transition-colors">
            Contact
          </Link>
        </div>
      </div>

      {/* Right */}
      <div className="flex items-center justify-center px-8 py-10 bg-zinc-100 dark:bg-zinc-100 text-zinc-900">
        <div className="w-full max-w-[470px]">
          {/* Mobile characters */}
          <div className="md:hidden mb-8 rounded-2xl overflow-hidden bg-[radial-gradient(circle_at_20%_20%,rgba(99,102,241,0.2),transparent_30%),linear-gradient(135deg,#0f172a_0%,#111827_100%)] p-4">
            <div className="text-white text-sm font-semibold mb-2">Alpha ATC Labeling</div>
            <div className="h-[180px]">
                <Characters focus={focus} emailLength={email.length} passwordLength={password.length} />
            </div>
          </div>

          <div className="text-center mb-10">
            <h1 className="text-5xl font-bold tracking-tight mb-3">Welcome back!</h1>
            <p className="text-zinc-500 text-2xl">Please enter your details</p>
            <p className="text-xs text-zinc-400 mt-2">UI build: v2</p>
          </div>

          <form onSubmit={onSubmit} className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="email" className="text-3xl font-medium">
                Email
              </Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onFocus={() => setFocus("email")}
                onBlur={() => setFocus(null)}
                placeholder="anna@gmail.com"
                className="h-14 text-2xl rounded-2xl bg-white border-zinc-200"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password" className="text-3xl font-medium">
                Password
              </Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPwd ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onFocus={() => setFocus("password")}
                  onBlur={() => setFocus(null)}
                  className="h-14 text-2xl rounded-2xl bg-white border-zinc-200 pr-12"
                />
                <button
                  type="button"
                  onClick={() => setShowPwd((v) => !v)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-700"
                >
                  {showPwd ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between text-xl">
              <label className="flex items-center gap-2 cursor-pointer">
                <Checkbox checked={remember} onCheckedChange={(v) => setRemember(Boolean(v))} />
                <span>Remember for 30 days</span>
              </label>
              <Link href="#" className="hover:underline">
                Forgot password?
              </Link>
            </div>

            <Button
              type="submit"
              disabled={!valid || loading}
              className="w-full h-14 rounded-2xl text-3xl bg-zinc-900 hover:bg-zinc-800 text-white"
            >
              {loading ? "Logging in..." : "Log in"}
            </Button>

            <Button
              type="button"
              variant="outline"
              className="w-full h-14 rounded-2xl text-3xl bg-white border-zinc-200 text-zinc-900"
            >
              Log in with Google
            </Button>

            {errorText ? (
              <div className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-red-700 text-sm">{errorText}</div>
            ) : null}

            <div className="text-center text-xl text-zinc-600 mt-2">
              Don&apos;t have an account? <span className="font-semibold text-zinc-900">Sign Up</span>
            </div>
          </form>

          <div className="mt-6 text-sm text-zinc-500">Demo Page</div>
        </div>
      </div>
    </div>
  );
}

