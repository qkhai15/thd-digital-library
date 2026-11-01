import NextImage, { type ImageProps } from "next/image";

// The internal optimizer does not follow our /uploads -> Storage redirect.
// Browser image requests do; keep legacy URLs intact and use the Storage CDN.
export default function StorageImage(props: ImageProps) {
  const redirectedUpload = typeof props.src === "string" && props.src.startsWith("/uploads/");
  return <NextImage {...props} unoptimized={props.unoptimized || redirectedUpload} />;
}
