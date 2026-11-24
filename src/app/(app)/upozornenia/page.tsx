import type { Metadata } from "next";
import { Suspense } from "react";
import { BellOff } from "lucide-react";
import { NotificationItem } from "@/components/notification-item";
import { Card, EmptyState, PageHeader, PageSkeleton } from "@/components/ui/card";
import { requireMember } from "@/lib/auth";
import { getNotifications } from "@/lib/data";
import { MarkSeen } from "./mark-seen";

export const metadata: Metadata = { title: "Upozornenia" };

async function Notifications() {
  await requireMember();
  const notifications = await getNotifications();
  const unread = notifications.filter((n) => !n.read_at).map((n) => n.id);

  return (
    <div className="animate-rise mx-auto max-w-2xl">
      <PageHeader title="Upozornenia" subtitle={unread.length > 0 ? `${unread.length} nových` : "Všetko prečítané"} />
      {notifications.length === 0 ? (
        <EmptyState icon={<BellOff />} title="Žiadne upozornenia" text="Nové termíny, hlasovania a platby sa objavia tu." />
      ) : (
        <Card className="overflow-hidden">
          <ul className="divide-y divide-line">
            {notifications.map((n) => (
              <li key={n.id}>
                <NotificationItem notification={n} />
              </li>
            ))}
          </ul>
        </Card>
      )}
      {/* Nové položky ostanú na tejto obrazovke zvýraznené; ako prečítané sa označia na pozadí. */}
      <MarkSeen ids={unread} />
    </div>
  );
}

export default function NotificationsPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Notifications />
    </Suspense>
  );
}
