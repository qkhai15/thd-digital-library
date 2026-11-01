import type { ImageProps } from "next/image";
import Image from "@/components/StorageImage";

// Admin may enter external image URLs without changing the Next.js allowlist.
export default function ContentImage(props: ImageProps) {
  const external = typeof props.src === "string" && /^https?:\/\//.test(props.src);
  return <Image {...props} alt={props.alt} unoptimized={external || props.unoptimized} />;
}
