import { useEffect, useState } from "react";

/**
 * Registers the offline worker and reports when a newer build is sitting in
 * the wings. Nothing here runs in development: a worker caching a dev server's
 * output is only ever confusing.
 */
export function useServiceWorker() {
  const [updateReady, setUpdateReady] = useState(false);
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);

  useEffect(() => {
    if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;

    let cancelled = false;
    let timer = 0;

    const follow = (installing: ServiceWorker) => {
      installing.addEventListener("statechange", () => {
        // A worker that reaches "installed" with no controller is the very
        // first one — that is a fresh visit, not an update to announce.
        if (installing.state === "installed" && navigator.serviceWorker.controller && !cancelled) {
          setWaiting(installing);
          setUpdateReady(true);
        }
      });
    };

    const watch = (registration: ServiceWorkerRegistration) => {
      if (registration.waiting && navigator.serviceWorker.controller) {
        setWaiting(registration.waiting);
        setUpdateReady(true);
      }
      // An update that was already downloading when the page got here has
      // fired its "updatefound" before anyone listened.
      if (registration.installing) follow(registration.installing);
      registration.addEventListener("updatefound", () => {
        if (registration.installing) follow(registration.installing);
      });
    };

    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL })
      .then((registration) => {
        if (cancelled) return;
        watch(registration);
        // Catch deploys that land while a long session is still open.
        timer = window.setInterval(
          () => void registration.update().catch(() => undefined),
          60 * 60 * 1000,
        );
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
      if (timer) window.clearInterval(timer);
    };
  }, []);

  const applyUpdate = () => {
    setUpdateReady(false);
    // The worker skips waiting by itself (public/sw.js), so by the time the
    // button is pressed it has usually taken over already and no
    // "controllerchange" is coming: waiting for one left the button doing
    // nothing. A worker that is already in charge only needs a reload.
    if (!waiting || waiting.state === "activating" || waiting.state === "activated" || waiting.state === "redundant") {
      window.location.reload();
      return;
    }
    // controllerchange fires once the new worker takes over; reloading then
    // means the page is served entirely by the new build. The listener goes
    // on before the message, and a timer covers a worker that never answers.
    const fallback = window.setTimeout(() => window.location.reload(), 3000);
    navigator.serviceWorker.addEventListener(
      "controllerchange",
      () => {
        window.clearTimeout(fallback);
        window.location.reload();
      },
      { once: true },
    );
    waiting.postMessage("skip-waiting");
  };

  return { updateReady, applyUpdate };
}

/** Tracks connectivity so the shell can say which parts still work offline. */
export function useOnline() {
  const [online, setOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine,
  );

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  return online;
}
