/**
 * The switches the admin area throws, as the site sees them.
 *
 * One public row says whether the site is closed for maintenance, what notice
 * everybody should see, and which tools are turned off — so a broken service
 * can be taken off the shelf in a second, without a new version of the site.
 * Unreachable settings mean "everything is open": a failure here never closes
 * the site by accident.
 */
import { useEffect, useState } from "react";
import { supabase } from "./supabase";

export type SiteControl = {
  maintenance: boolean;
  maintenanceMessage: string | null;
  banner: string | null;
  bannerKind: "info" | "warn" | "good";
  disabledTools: string[];
};

export const OPEN_SITE: SiteControl = {
  maintenance: false,
  maintenanceMessage: null,
  banner: null,
  bannerKind: "info",
  disabledTools: [],
};

type Row = {
  maintenance?: boolean | null;
  maintenance_message?: string | null;
  banner?: string | null;
  banner_kind?: string | null;
  disabled_tools?: string[] | null;
};

export function normalizeControl(row: Row | null | undefined): SiteControl {
  if (!row) return OPEN_SITE;
  const kind = row.banner_kind === "warn" || row.banner_kind === "good" ? row.banner_kind : "info";
  return {
    maintenance: Boolean(row.maintenance),
    maintenanceMessage: row.maintenance_message?.trim() || null,
    banner: row.banner?.trim() || null,
    bannerKind: kind,
    disabledTools: Array.isArray(row.disabled_tools) ? row.disabled_tools.filter(Boolean) : [],
  };
}

export async function fetchSiteControl(): Promise<SiteControl> {
  const { data, error } = await supabase
    .from("site_control")
    .select("maintenance, maintenance_message, banner, banner_kind, disabled_tools")
    .maybeSingle<Row>();
  if (error) throw error;
  return normalizeControl(data);
}

/** The notices, fetched after the first paint and again every few minutes. */
export function useSiteControl() {
  const [control, setControl] = useState<SiteControl>(OPEN_SITE);

  useEffect(() => {
    let alive = true;
    const load = () => {
      void fetchSiteControl()
        .then((next) => {
          if (alive) setControl(next);
        })
        .catch(() => undefined);
    };
    const first = window.setTimeout(load, 0);
    const again = window.setInterval(load, 5 * 60_000);
    return () => {
      alive = false;
      window.clearTimeout(first);
      window.clearInterval(again);
    };
  }, []);

  return control;
}
