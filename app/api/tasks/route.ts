import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

/* Minimal task store behind the dashboard's "Assign task" action. The
   employee-performance module (phase 4) builds on this same table — keep the
   surface small: list, create, update status. */

const VALID_STATUS = new Set(["open", "in_progress", "done"]);

export async function GET() {
  const { data, error } = await supabase
    .from("tasks")
    .select("id, title, detail, source, source_ref, assignee, status, created_at, updated_at")
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ tasks: data ?? [] });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  if (!title) return NextResponse.json({ error: "title is required" }, { status: 400 });

  const { data, error } = await supabase
    .from("tasks")
    .insert({
      title: title.slice(0, 300),
      detail: typeof body.detail === "string" ? body.detail.slice(0, 2000) : "",
      source: body.source === "insight" ? "insight" : "manual",
      source_ref: typeof body.source_ref === "string" ? body.source_ref.slice(0, 200) : "",
      assignee: typeof body.assignee === "string" ? body.assignee.slice(0, 100) : "",
    })
    .select("id, title, assignee, status, created_at")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ task: data });
}

export async function PATCH(request: Request) {
  const body = await request.json().catch(() => null);
  const id = typeof body?.id === "string" ? body.id : "";
  const status = typeof body?.status === "string" ? body.status : "";
  if (!id || !VALID_STATUS.has(status)) {
    return NextResponse.json({ error: "id and a valid status are required" }, { status: 400 });
  }
  const { error } = await supabase
    .from("tasks")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
