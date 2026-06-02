import { listAllTableItems, updateUserRole } from "@/lib/backend-api";

export type AdminUser = {
  user_id: number;
  username: string;
  email: string | null;
  role: string;
};

export type AdminAudio = {
  audio_id: number;
  file_name: string;
  source_url: string;
  duration_ms: number;
  start_time_utc: string;
  end_time_utc: string;
  track_id: number;
  status: number;
  last_access_at?: string | null;
};

export type AdminAnnotation = {
  annotation_id: number;
  audio_id: number;
  author_id: number;
  label_type?: string | null;
  relative_start?: number | null;
  relative_end?: number | null;
  is_annotated?: number | null;
  annotation_text?: string | null;
  asr_content?: string | null;
};

export type AdminUserBundle = {
  user: AdminUser;
  annotationCount: number;
  audioIds: number[];
  audios: AdminAudio[];
};

export type AuthorAnnotationStats = {
  author_id: number;
  username: string;
  annotationCount: number;
  audioCount: number;
};

export type AdminSnapshot = {
  users: AdminUser[];
  audios: AdminAudio[];
  annotations: AdminAnnotation[];
  trackCount: number;
  bundlesByUserId: Map<number, AdminUserBundle>;
  audioById: Map<number, AdminAudio>;
  /** 按标注 author_id 汇总（用于解释「为何某用户没有关联录音」） */
  authorStats: AuthorAnnotationStats[];
};

function num(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function str(v: unknown): string {
  return v == null ? "" : String(v);
}

function normalizeUser(row: Record<string, unknown>): AdminUser {
  return {
    user_id: num(row.user_id),
    username: str(row.username) || `user_${row.user_id}`,
    email: row.email == null ? null : str(row.email),
    role: str(row.role) || "viewer",
  };
}

function normalizeAudio(row: Record<string, unknown>): AdminAudio {
  return {
    audio_id: num(row.audio_id),
    file_name: str(row.file_name) || str(row.source_url) || `audio_${row.audio_id}`,
    source_url: str(row.source_url),
    duration_ms: num(row.duration_ms),
    start_time_utc: str(row.start_time_utc),
    end_time_utc: str(row.end_time_utc),
    track_id: num(row.track_id),
    status: num(row.status),
    last_access_at: row.last_access_at == null ? null : str(row.last_access_at),
  };
}

function normalizeAnnotation(row: Record<string, unknown>): AdminAnnotation {
  return {
    annotation_id: num(row.annotation_id),
    audio_id: num(row.audio_id),
    author_id: num(row.author_id),
    label_type: row.label_type == null ? null : str(row.label_type),
    relative_start: row.relative_start == null ? null : num(row.relative_start),
    relative_end: row.relative_end == null ? null : num(row.relative_end),
    is_annotated: row.is_annotated == null ? null : num(row.is_annotated),
    annotation_text: row.annotation_text == null ? null : str(row.annotation_text),
    asr_content: row.asr_content == null ? null : str(row.asr_content),
  };
}

export function buildAdminSnapshot(
  userRows: Record<string, unknown>[],
  audioRows: Record<string, unknown>[],
  annotationRows: Record<string, unknown>[],
  trackCount: number
): AdminSnapshot {
  const users = userRows.map(normalizeUser).sort((a, b) => a.user_id - b.user_id);
  const audios = audioRows.map(normalizeAudio).sort((a, b) => b.audio_id - a.audio_id);
  const annotations = annotationRows.map(normalizeAnnotation);
  const audioById = new Map(audios.map((a) => [a.audio_id, a]));

  const bundlesByUserId = new Map<number, AdminUserBundle>();
  for (const u of users) {
    bundlesByUserId.set(u.user_id, {
      user: u,
      annotationCount: 0,
      audioIds: [],
      audios: [],
    });
  }

  const audioIdsByUser = new Map<number, Set<number>>();
  for (const ann of annotations) {
    const uid = ann.author_id;
    if (!audioIdsByUser.has(uid)) audioIdsByUser.set(uid, new Set());
    audioIdsByUser.get(uid)!.add(ann.audio_id);
    const bundle = bundlesByUserId.get(uid);
    if (bundle) bundle.annotationCount += 1;
  }

  for (const [uid, ids] of audioIdsByUser) {
    const bundle = bundlesByUserId.get(uid);
    if (!bundle) continue;
    bundle.audioIds = [...ids].sort((a, b) => b - a);
    bundle.audios = bundle.audioIds
      .map((id) => audioById.get(id))
      .filter((x): x is AdminAudio => Boolean(x));
  }

  const usersById = new Map(users.map((u) => [u.user_id, u]));
  const authorStats: AuthorAnnotationStats[] = [];
  for (const [authorId, audioSet] of audioIdsByUser) {
    const bundle = bundlesByUserId.get(authorId);
    const u = usersById.get(authorId);
    authorStats.push({
      author_id: authorId,
      username: u?.username ?? `用户#${authorId}`,
      annotationCount: bundle?.annotationCount ?? 0,
      audioCount: audioSet.size,
    });
  }
  authorStats.sort((a, b) => b.annotationCount - a.annotationCount);

  return {
    users,
    audios,
    annotations,
    trackCount,
    bundlesByUserId,
    audioById,
    authorStats,
  };
}

export async function fetchAdminSnapshot(): Promise<AdminSnapshot> {
  const [userRows, audioRows, annotationRows, trackRows] = await Promise.all([
    listAllTableItems<Record<string, unknown>>("users"),
    listAllTableItems<Record<string, unknown>>("audio_records"),
    listAllTableItems<Record<string, unknown>>("annotations"),
    listAllTableItems<Record<string, unknown>>("tracks"),
  ]);
  return buildAdminSnapshot(userRows, audioRows, annotationRows, trackRows.length);
}

export async function patchUserRole(
  userId: number,
  role: "admin" | "annotator" | "viewer"
): Promise<AdminUser> {
  const res = await updateUserRole(userId, role);
  const u = res.data;
  return {
    user_id: num(u.user_id),
    username: str(u.username),
    email: u.email == null ? null : str(u.email),
    role: str(u.role) || role,
  };
}

export function formatDurationMs(ms: number): string {
  const sec = Math.max(0, ms) / 1000;
  if (sec < 60) return `${sec.toFixed(0)}s`;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
