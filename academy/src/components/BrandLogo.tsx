"use client";

import { useEffect, useState } from "react";
import { DEPARTMENTS, type Department } from "@/lib/types";

/**
 * public/logos/u2m.png · studykiller.png 를 넣으면 자동으로 원본 로고가 뜬다.
 * 넣기 전까지는 같은 네이비 톤의 대체 마크가 표시된다(에러 아님).
 * 깨진 이미지가 잠깐이라도 보이지 않도록 먼저 로드해 보고 성공했을 때만 <img> 를 그린다.
 */
export default function BrandLogo({
  dept,
  size = 36,
  className = "",
}: {
  dept: Department;
  size?: number;
  className?: string;
}) {
  const brand = DEPARTMENTS[dept];
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    setReady(false);
    const img = new window.Image();
    img.onload = () => {
      if (alive) setReady(true);
    };
    img.onerror = () => {
      if (alive) setReady(false);
    };
    img.src = brand.logo;
    return () => {
      alive = false;
    };
  }, [brand.logo]);

  if (ready) {
    return (
      // 로고는 사용자가 나중에 넣는 파일이라 next/image 최적화를 쓰지 않는다
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={brand.logo}
        alt={brand.brand}
        className={`object-contain ${className}`}
        style={{ width: size, height: size }}
      />
    );
  }

  const label = dept === "ELEM" ? "U2M" : "SK";
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-lg bg-navy-800 font-bold text-white ${className}`}
      style={{ width: size, height: size, fontSize: Math.max(10, size * 0.3) }}
      aria-label={brand.brand}
      title={brand.brand}
    >
      {label}
    </span>
  );
}
