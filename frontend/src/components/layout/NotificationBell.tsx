"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Bell, Check, CheckCheck, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import {
  useNotifications,
  useMarkRead,
  useMarkAllRead,
  type UserNotification,
} from "@/hooks/useNotifications";
import { fmtRelative } from "@/lib/format";
import { clsx } from "@/lib/format";
import { connectSocket } from "@/lib/socket";
import { useAuth } from "@/lib/auth";
import {
  playNotificationSound,
  showBrowserNotification,
  unlockNotificationSound,
  saveNotificationSoundPreferences,
} from "@/lib/notificationSound";

const TYPE_COLORS: Record<string, string> = {
  partner_request: "bg-violet-100 text-violet-700",
  request_approved: "bg-emerald-100 text-emerald-700",
  request_rejected: "bg-rose-100 text-rose-700",
  request_partially_fulfilled: "bg-amber-100 text-amber-700",
  lead_request: "bg-indigo-100 text-indigo-700",
  lead_request_created: "bg-indigo-100 text-indigo-700",
  lead_request_approved: "bg-emerald-100 text-emerald-700",
  lead_request_partially_approved: "bg-amber-100 text-amber-700",
  lead_request_rejected: "bg-rose-100 text-rose-700",
  lead_request_submitted: "bg-indigo-100 text-indigo-700",
  rm_lead_request: "bg-cyan-100 text-cyan-700",
  rm_lead_request_created: "bg-cyan-100 text-cyan-700",
  rm_lead_request_approved: "bg-emerald-100 text-emerald-700",
  rm_lead_request_rejected: "bg-rose-100 text-rose-700",
  rm_lead_request_submitted: "bg-cyan-100 text-cyan-700",
  leads_assigned: "bg-blue-100 text-blue-700",
  leads_reassigned: "bg-purple-100 text-purple-700",
  leads_delivered: "bg-blue-100 text-blue-700",
  bulk_leads_assigned: "bg-blue-100 text-blue-700",
  auto_leads_distributed: "bg-sky-100 text-sky-700",
  lead_request_needs_approval: "bg-amber-100 text-amber-700",
  partner_request_created: "bg-violet-100 text-violet-700",
  partner_request_approved: "bg-emerald-100 text-emerald-700",
  partner_request_partially_approved: "bg-amber-100 text-amber-700",
  partner_request_rejected: "bg-rose-100 text-rose-700",
  lead_assigned: "bg-blue-100 text-blue-700",
  rm_assigned: "bg-sky-100 text-sky-700",
};

const INITIAL_VISIBLE_COUNT = 6;
const LOAD_MORE_COUNT = 6;

function typeLabel(type: string) {
  return type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function notificationTarget(n: UserNotification) {
  const leadId =
    typeof n.metadata?.lead_id === "string" ? n.metadata.lead_id : null;

  if (leadId) return `/leads/${leadId}`;

  if (Array.isArray(n.metadata?.lead_ids) && n.metadata.lead_ids.length > 0) {
    return "/leads";
  }

  const eventType = String(n.metadata?.event_type || n.type || "");

  if (eventType.includes("partner_request")) return "/lead-requests";

  if (
    eventType.includes("lead_request") ||
    eventType.includes("rm_lead_request") ||
    eventType.includes("request_")
  ) {
    return "/lead-requests";
  }

  if (eventType.includes("reassigned") || eventType.includes("assigned")) {
    return "/leads";
  }

  return null;
}

function NotificationSkeleton() {
  return (
    <div className="grid gap-3 px-4 py-4">
      {Array.from({ length: 4 }).map((_, index) => (
        <div key={index} className="flex gap-3">
          <div className="h-9 w-9 shrink-0 animate-pulse rounded-full bg-slate-100" />
          <div className="grid flex-1 gap-2">
            <div className="h-3 w-4/5 animate-pulse rounded bg-slate-100" />
            <div className="h-3 w-3/5 animate-pulse rounded bg-slate-100" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE_COUNT);
  const ref = useRef<HTMLDivElement>(null);
  const qc = useQueryClient();
  const router = useRouter();
  const { user } = useAuth();
  const { data, isLoading } = useNotifications();
  const markRead = useMarkRead();
  const markAll = useMarkAllRead();

  const unread = data?.unread ?? 0;
  const items = data?.notifications ?? [];

  const visibleItems = useMemo(
    () => items.slice(0, visibleCount),
    [items, visibleCount],
  );

  const hasMoreLocal = visibleCount < items.length;

  useEffect(() => {
    if (!open) return;

    setVisibleCount(INITIAL_VISIBLE_COUNT);

    const handler = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    const escapeHandler = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    window.addEventListener("mousedown", handler);
    window.addEventListener("keydown", escapeHandler);

    return () => {
      window.removeEventListener("mousedown", handler);
      window.removeEventListener("keydown", escapeHandler);
    };
  }, [open]);

  useEffect(() => {
    let cleanup: (() => void) | null = null;

    connectSocket()
      .then((socket) => {
        const handler = (notification?: UserNotification) => {
          qc.invalidateQueries({ queryKey: ["notifications"] });

          const belongsToUser =
            !notification?.user_id || notification.user_id === user?.id;

          if (belongsToUser && notification?.title) {
            playNotificationSound().then((result) => {
              if (result.reason === "blocked") {
                toast("Click Enable Sound to allow notification audio.", {
                  id: "notification-sound-blocked",
                });
              }
            });

            showBrowserNotification(
              notification.title,
              notification.body || notification.message || null,
            );
          }

          if (notification?.title) {
            toast.success(notification.title, {
              id: `notif-${notification.id || notification.type}`,
              duration: 4000,
            });
          }
        };

        socket.on("notification:new", handler);
        cleanup = () => socket.off("notification:new", handler);
      })
      .catch(() => {});

    return () => {
      cleanup?.();
    };
  }, [qc, user?.id]);

  function handleBellClick() {
    setOpen((value) => !value);
    saveNotificationSoundPreferences({ soundEnabled: true });
    unlockNotificationSound().catch(() => {});
  }

  function handleNotificationClick(notification: UserNotification) {
    if (!notification.is_read) {
      markRead.mutate(notification.id);
    }
  }

  function handleScroll(event: React.UIEvent<HTMLDivElement>) {
    const target = event.currentTarget;
    const nearBottom =
      target.scrollTop + target.clientHeight >= target.scrollHeight - 72;

    if (!nearBottom || !hasMoreLocal) return;

    setVisibleCount((current) =>
      Math.min(current + LOAD_MORE_COUNT, items.length),
    );
  }

  function goToNotificationsPage() {
    setOpen(false);
    router.push("/notifications");
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={handleBellClick}
        className={clsx(
          "notification-trigger relative grid h-10 w-10 place-items-center rounded-[4px] border border-slate-200 bg-white text-slate-600 shadow-sm transition",
          "hover:-translate-y-0.5 hover:border-slate-300 hover:bg-slate-50 hover:text-slate-950 hover:shadow-md active:scale-[0.96]",
          open && "border-slate-300 bg-slate-50 text-slate-950 shadow-md",
        )}
        aria-label="Notifications"
        aria-expanded={open}
      >
        <Bell className="h-[18px] w-[18px]" />

        {unread > 0 ? (
          <>
            <span className="absolute -right-1 -top-1 h-5 min-w-5 rounded-full bg-rose-500/40 blur-[2px]" />
            <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full border-2 border-white bg-rose-500 px-1 text-[10px] font-black leading-none text-white shadow-sm">
              {unread > 99 ? "99+" : unread}
            </span>
          </>
        ) : null}
      </button>

      {open ? (
        <div className="notification-panel absolute right-0 z-50 mt-3 w-[calc(100vw-24px)] max-w-[390px] overflow-hidden rounded-[4px] border border-slate-200 bg-white shadow-[0_24px_70px_rgba(15,23,42,0.18)] sm:w-96">
          <div className="border-b border-slate-100 bg-white px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[4px] bg-slate-100 text-slate-700">
                    <Bell className="h-4 w-4" />
                  </span>

                  <div className="min-w-0">
                    <p className="text-sm font-black leading-none text-slate-950">
                      Notifications
                    </p>
                    <p className="mt-1 text-xs font-medium text-slate-500">
                      Latest updates and alerts
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-1">
                {unread > 0 ? (
                  <button
                    type="button"
                    onClick={() => markAll.mutate()}
                    className="inline-flex h-8 items-center gap-1.5 rounded-[4px] border border-slate-200 bg-white px-2 text-xs font-bold text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-950 active:scale-[0.98]"
                    title="Mark all read"
                  >
                    <CheckCheck className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">Mark all</span>
                  </button>
                ) : null}

                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="grid h-8 w-8 place-items-center rounded-[4px] text-slate-400 transition hover:bg-slate-100 hover:text-slate-900 active:scale-[0.96]"
                  aria-label="Close notifications"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="mt-3 flex items-center gap-2">
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-bold text-slate-600">
                {items.length} total
              </span>

              {unread > 0 ? (
                <span className="rounded-full bg-rose-50 px-2.5 py-1 text-[11px] font-black text-rose-600">
                  {unread} unread
                </span>
              ) : (
                <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-black text-emerald-600">
                  All caught up
                </span>
              )}

              {items.length > visibleItems.length ? (
                <span className="ml-auto text-[11px] font-semibold text-slate-400">
                  Showing {visibleItems.length}/{items.length}
                </span>
              ) : null}
            </div>
          </div>

          <div
            className="notification-scroll max-h-[300px] overflow-y-auto"
            onScroll={handleScroll}
          >
            {isLoading ? (
              <NotificationSkeleton />
            ) : items.length === 0 ? (
              <div className="px-5 py-8 text-center">
                <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-slate-100 text-slate-400">
                  <Bell className="h-5 w-5" />
                </div>

                <p className="mt-3 text-sm font-black text-slate-700">
                  No notifications yet
                </p>
                <p className="mt-1 text-xs font-medium text-slate-400">
                  New alerts will appear here automatically.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {visibleItems.map((notification: UserNotification) => {
                  const target = notificationTarget(notification);
                  const tone =
                    TYPE_COLORS[notification.type] ||
                    "bg-slate-100 text-slate-600";

                  return (
                    <button
                      key={notification.id}
                      type="button"
                      onClick={() => handleNotificationClick(notification)}
                      className={clsx(
                        "group flex w-full gap-3 px-4 py-3 text-left transition",
                        "hover:bg-slate-50 active:bg-slate-100",
                        !notification.is_read ? "bg-blue-50/50" : "bg-white",
                      )}
                      title={target || undefined}
                    >
                      <div className="mt-0.5 shrink-0">
                        <div
                          className={clsx(
                            "relative grid h-9 w-9 place-items-center rounded-[4px] text-xs font-black ring-1 ring-inset ring-black/5",
                            tone,
                          )}
                        >
                          {!notification.is_read ? (
                            <>
                              <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-blue-500 ring-2 ring-white" />
                              <Bell className="h-4 w-4" />
                            </>
                          ) : (
                            <Check className="h-4 w-4" />
                          )}
                        </div>
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <span
                            className={clsx(
                              "line-clamp-2 text-sm leading-5",
                              !notification.is_read
                                ? "font-black text-slate-950"
                                : "font-semibold text-slate-700",
                            )}
                          >
                            {notification.title}
                          </span>

                          <span className="mt-0.5 shrink-0 whitespace-nowrap text-[10px] font-semibold text-slate-400">
                            {fmtRelative(notification.created_at)}
                          </span>
                        </div>

                        {notification.body ? (
                          <p className="mt-1 line-clamp-2 text-xs font-medium leading-5 text-slate-500">
                            {notification.body}
                          </p>
                        ) : null}

                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <span
                            className={clsx(
                              "inline-flex rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.08em]",
                              tone,
                            )}
                          >
                            {typeLabel(notification.type)}
                          </span>

                          {!notification.is_read ? (
                            <span className="inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.08em] text-blue-700">
                              New
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </button>
                  );
                })}

                {hasMoreLocal ? (
                  <div className="px-4 py-3 text-center text-xs font-semibold text-slate-400">
                    Scroll down to load more
                  </div>
                ) : items.length > INITIAL_VISIBLE_COUNT ? (
                  <div className="px-4 py-3 text-center text-xs font-semibold text-slate-400">
                    All notifications loaded
                  </div>
                ) : null}
              </div>
            )}
          </div>

          <div className="border-t border-slate-100 bg-white p-3">
            <button
              type="button"
              onClick={goToNotificationsPage}
              className="flex h-10 w-full items-center justify-center text-sm font-black text-blue-600 transition"
            >
              View all notifications
            </button>
          </div>
        </div>
      ) : null}

      <style jsx>{`
        .notification-panel {
          animation: notificationPanelIn 180ms ease-out;
          transform-origin: top right;
        }

        @keyframes notificationPanelIn {
          from {
            opacity: 0;
            transform: translateY(-6px) scale(0.98);
          }

          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }

        .notification-trigger {
          transform: translateZ(0);
        }

        .notification-scroll {
          scrollbar-width: none;
          -ms-overflow-style: none;
          overscroll-behavior: contain;
        }

        .notification-scroll::-webkit-scrollbar {
          display: none;
          width: 0;
          height: 0;
        }

        @media (max-width: 480px) {
          .notification-panel {
            right: -8px;
            max-width: calc(100vw - 18px);
          }

          .notification-scroll {
            max-height: 270px;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .notification-panel,
          .notification-trigger,
          .notification-panel * {
            animation: none !important;
            transition: none !important;
          }
        }
      `}</style>
    </div>
  );
}