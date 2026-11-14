import { useState } from "react";
import ThemeToggle from "@/components/ThemeToggle";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { primeAudio, readSoundSetting, writeSoundSetting } from "@/features/alerts";

type Permission = NotificationPermission | "unsupported";

const notificationPermission = (): Permission =>
  typeof Notification === "undefined" ? "unsupported" : Notification.permission;

interface TopBarProps {
  connected: boolean;
  onAdd: () => void;
}

export default function TopBar({ connected, onAdd }: TopBarProps) {
  const [soundOn, setSoundOn] = useState(readSoundSetting);
  const [permission, setPermission] = useState<Permission>(notificationPermission);

  const toggleSound = () => {
    const next = !soundOn;
    if (next) primeAudio();
    setSoundOn(next);
    writeSoundSetting(next);
  };

  const enableNotifications = async () => {
    primeAudio();
    try {
      setPermission(await Notification.requestPermission());
    } catch {
      setPermission(notificationPermission());
    }
  };

  return (
    <header className="mb-3 border-b bg-card">
      <div className="flex w-full flex-wrap items-center gap-2 px-4 py-2">
        <span className="text-lg font-semibold">NetPulse</span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Badge
            aria-live="polite"
            className={connected ? "bg-emerald-500 text-white" : "bg-amber-500 text-black"}
          >
            {connected ? "Live" : "Reconnecting"}
          </Badge>
          {permission === "default" && (
            <Button size="sm" variant="outline" className="text-nowrap" onClick={enableNotifications}>
              Enable notifications
            </Button>
          )}
          <ThemeToggle />
          <Button
            size="sm"
            variant={soundOn ? "secondary" : "outline"}
            className="text-nowrap"
            aria-pressed={soundOn}
            onClick={toggleSound}
          >
            Sound {soundOn ? "on" : "off"}
          </Button>
          <Button size="sm" className="text-nowrap" onClick={onAdd}>
            Add device
          </Button>
        </div>
      </div>
    </header>
  );
}
