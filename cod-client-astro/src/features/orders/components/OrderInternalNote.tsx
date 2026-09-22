import { useEffect, useState } from "react";
import { Check, Pencil, StickyNote, X } from "lucide-react";
import { canScope, useIdentity } from "@/features/auth/components/RequireAuth";
import { useT } from "@/i18n/react";
import { notify } from "@/lib/notify";
import { updateOrderInternalNote } from "@/features/orders/api";
import { Card } from "@/components/ui";

interface InternalNoteProps {
  orderId: string;
  orderNumber: string;
  initialNote: string | null;
  onSaved: (note: string | null) => void;
  onError: (message: string) => void;
}

function useNoteDraft(initialNote: string | null) {
  const [note, setNote] = useState(initialNote ?? "");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!editing) setNote(initialNote ?? "");
  }, [initialNote, editing]);

  function startEditing() {
    setDraft(note);
    setEditing(true);
  }

  return { note, editing, draft, saving, setDraft, setSaving, startEditing, setEditing, setNote };
}

async function persistNote(
  orderId: string,
  draft: string,
  actions: {
    setSaving: (busy: boolean) => void;
    setNote: (note: string) => void;
    setEditing: (editing: boolean) => void;
    onSaved: (note: string | null) => void;
    onError: (message: string) => void;
    savedMessage: string;
    failedMessage: string;
  },
) {
  const trimmed = draft.trim();
  actions.setSaving(true);
  try {
    await updateOrderInternalNote(orderId, trimmed ? trimmed : null);
  } catch (cause) {
    actions.setSaving(false);
    const message = cause instanceof Error ? cause.message : String(cause);
    actions.onError(message);
    notify.error(actions.failedMessage);
    return;
  }
  actions.setSaving(false);
  actions.setNote(trimmed);
  actions.setEditing(false);
  actions.onSaved(trimmed ? trimmed : null);
  notify.success(actions.savedMessage);
}

export function OrderNoteCell({ orderId, orderNumber, initialNote, onSaved, onError }: InternalNoteProps) {
  const t = useT("orders");
  const common = useT("common");
  const identity = useIdentity();
  const state = useNoteDraft(initialNote);
  const { note, editing, draft, saving } = state;
  const canEdit = canScope(identity, "orders:update");

  if (editing) {
    return (
      <div className="min-w-44" onClick={(event) => event.stopPropagation()}>
        <textarea
          autoFocus
          value={draft}
          maxLength={2000}
          rows={2}
          onChange={(event) => state.setDraft(event.currentTarget.value)}
          placeholder={t("note.placeholder")}
          aria-label={t("note.edit").replace("{name}", orderNumber)}
          className="w-full resize-y rounded-lg border border-input bg-background px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <div className="mt-1 flex items-center gap-1">
          <button
            type="button"
            disabled={saving}
            onClick={() =>
              void persistNote(orderId, draft, {
                setSaving: state.setSaving,
                setNote: state.setNote,
                setEditing: state.setEditing,
                onSaved,
                onError,
                savedMessage: common("feedback.saved"),
                failedMessage: common("feedback.action_failed"),
              })
            }
            aria-label={common("confirm")}
            className="grid size-7 place-items-center rounded-md bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            <Check size={14} />
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => state.setEditing(false)}
            aria-label={common("cancel")}
            className="grid size-7 place-items-center rounded-md border border-input text-muted-foreground hover:bg-muted disabled:opacity-50"
          >
            <X size={14} />
          </button>
        </div>
      </div>
    );
  }

  if (!canEdit) {
    return note ? (
      <span className="block max-w-44 truncate text-xs text-foreground" title={note}>
        {note}
      </span>
    ) : (
      <span className="text-xs text-muted-foreground">—</span>
    );
  }

  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        state.startEditing();
      }}
      title={note || undefined}
      aria-label={`${t("note.edit").replace("{name}", orderNumber)}${note ? `: ${note}` : ""}`}
      className={`inline-flex max-w-44 items-start gap-1.5 rounded-lg px-2 py-1.5 text-start text-xs transition-colors hover:bg-muted ${
        note ? "text-foreground" : "border border-dashed border-input text-muted-foreground"
      }`}
    >
      <StickyNote size={14} className={`mt-0.5 shrink-0 ${note ? "text-warning" : ""}`} />
      <span className="truncate break-words">{note || t("note.add")}</span>
    </button>
  );
}

export function OrderInternalNoteCard({ orderId, orderNumber, initialNote, onSaved, onError }: InternalNoteProps) {
  const t = useT("orders");
  const common = useT("common");
  const identity = useIdentity();
  const state = useNoteDraft(initialNote);
  const { note, editing, draft, saving } = state;
  const canEdit = canScope(identity, "orders:update");

  return (
    <Card
      title={t("detail.internal_note")}
      action={
        canEdit && !editing ? (
          <button
            type="button"
            onClick={() => state.startEditing()}
            aria-label={t("note.edit").replace("{name}", orderNumber)}
            className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <Pencil size={14} />
          </button>
        ) : undefined
      }
    >
      {editing ? (
        <div className="space-y-2">
          <textarea
            autoFocus
            value={draft}
            maxLength={2000}
            rows={3}
            onChange={(event) => state.setDraft(event.currentTarget.value)}
            placeholder={t("note.placeholder")}
            aria-label={t("note.edit").replace("{name}", orderNumber)}
            className="w-full resize-y rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <p className="text-xs text-muted-foreground">{t("note.hint")}</p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={saving}
              onClick={() =>
                void persistNote(orderId, draft, {
                  setSaving: state.setSaving,
                  setNote: state.setNote,
                  setEditing: state.setEditing,
                  onSaved,
                  onError,
                  savedMessage: common("feedback.saved"),
                  failedMessage: common("feedback.action_failed"),
                })
              }
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              <Check size={14} />
              {t("note.save")}
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => state.setEditing(false)}
              className="h-9 rounded-lg px-3 text-sm font-semibold text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
            >
              {common("cancel")}
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-1.5">
          <p className="whitespace-pre-wrap break-words text-sm text-foreground">
            {note || t("detail.no_notes")}
          </p>
          <p className="text-xs text-muted-foreground">{t("note.hint")}</p>
        </div>
      )}
    </Card>
  );
}
