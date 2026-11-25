import { access } from "node:fs/promises";
import { fileURLToPath } from "node:url";

try {
  for (const name of ["empty-state", "item-card", "line-chart", "timeline"]) {
    const component = import.meta.resolve("@heroui-pro/react/" + name);
    await access(fileURLToPath(component));
  }
} catch {
  console.error(
    "A licensed HeroUI Pro component is missing. Authenticate HeroUI Pro locally or supply HEROUI_AUTH_TOKEN to the build install, then reinstall or rebuild @heroui-pro/react before building DataDeal.",
  );
  process.exit(1);
}
