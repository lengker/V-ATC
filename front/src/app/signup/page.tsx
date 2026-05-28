"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import { Eye, EyeOff, UserPlus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { authAPI } from "@/lib/api";

function SignupForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") || "/";
  const { login } = useAuth();
  const { toast } = useToast();

  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorText, setErrorText] = useState("");

  const valid = useMemo(() => {
    return username.trim().length >= 3 && password.length >= 6 && password === confirmPassword;
  }, [username, password, confirmPassword]);

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!valid) return;

    setLoading(true);
    setErrorText("");

    const signup = await authAPI.signup({
      username: username.trim(),
      password,
      display_name: displayName.trim() || username.trim(),
    });

    if (!signup.success) {
      const error = signup.error || "注册失败";
      setErrorText(error);
      toast({ title: "注册失败", description: error, variant: "destructive" });
      setLoading(false);
      return;
    }

    const loggedIn = await login({ email: username, password });
    if (!loggedIn.ok) {
      toast({ title: "账号已创建", description: "请使用新账号登录。" });
      router.replace("/login");
      return;
    }

    toast({ title: "账号已创建", description: "已为你自动登录。" });
    router.replace(next);
  };

  const passwordHint =
    password && confirmPassword && password !== confirmPassword
      ? "两次输入的密码不一致。"
      : "用户名至少 3 个字符，密码至少 6 个字符。";

  return (
    <div className="min-h-screen grid md:grid-cols-2 bg-zinc-100 text-zinc-900">
      <div className="hidden md:flex flex-col justify-between p-10 bg-[linear-gradient(135deg,#111827_0%,#172033_46%,#1f2937_100%)] text-white">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-white/10 border border-white/20 flex items-center justify-center">
            <UserPlus className="h-5 w-5" />
          </div>
          <div className="text-3xl font-bold">空管语音标注</div>
        </div>
        <div className="max-w-xl">
          <p className="text-sm uppercase tracking-[0.25em] text-cyan-200 mb-4">账号设置</p>
          <h1 className="text-6xl font-bold leading-tight">创建你的标注工作台账号</h1>
          <p className="mt-6 text-xl text-zinc-300">
            新账号会通过 Alpha 后端保存，并默认拥有标注员权限。
          </p>
        </div>
        <div className="text-sm text-zinc-400">账号认证服务</div>
      </div>

      <div className="flex items-center justify-center px-8 py-10">
        <div className="w-full max-w-[470px]">
          <div className="mb-10">
            <h2 className="text-5xl font-bold tracking-tight mb-3">注册账号</h2>
            <p className="text-zinc-500 text-xl">使用用户名和密码创建账号。</p>
          </div>

          <form onSubmit={onSubmit} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="username" className="text-2xl font-medium">
                用户名
              </Label>
              <Input
                id="username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                placeholder="new_user"
                className="h-14 text-xl rounded-2xl bg-white border-zinc-200"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="displayName" className="text-2xl font-medium">
                显示名称
              </Label>
              <Input
                id="displayName"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                placeholder="可选"
                className="h-14 text-xl rounded-2xl bg-white border-zinc-200"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password" className="text-2xl font-medium">
                密码
              </Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPwd ? "text" : "password"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="h-14 text-xl rounded-2xl bg-white border-zinc-200 pr-12"
                />
                <button
                  type="button"
                  onClick={() => setShowPwd((value) => !value)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-700"
                  aria-label={showPwd ? "隐藏密码" : "显示密码"}
                >
                  {showPwd ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirmPassword" className="text-2xl font-medium">
                确认密码
              </Label>
              <Input
                id="confirmPassword"
                type={showPwd ? "text" : "password"}
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                className="h-14 text-xl rounded-2xl bg-white border-zinc-200"
              />
              <p className="text-sm text-zinc-500">{passwordHint}</p>
            </div>

            {errorText ? (
              <div className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-red-700 text-sm">{errorText}</div>
            ) : null}

            <Button
              type="submit"
              disabled={!valid || loading}
              className="w-full h-14 rounded-2xl text-2xl bg-zinc-900 hover:bg-zinc-800 text-white"
            >
              {loading ? "正在创建..." : "创建账号"}
            </Button>

            <div className="text-center text-lg text-zinc-600">
              已有账号？{" "}
              <Link href="/login" className="font-semibold text-zinc-900 hover:underline">
                登录
              </Link>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

export default function SignupPage() {
  return (
    <Suspense fallback={<div className="min-h-screen grid place-items-center text-sm text-muted-foreground">正在加载注册页...</div>}>
      <SignupForm />
    </Suspense>
  );
}
