'use client';

import { useTransition, useState, useRef } from 'react';
import type { LandingSection } from '@/lib/db/landing-sections';
import {
  HERO_SLIDES,
  MASTERPIECE_TILES,
  LANDSCAPE_TILES,
  LIFESTYLE_BLOCKS,
  MEMBER_BENEFIT_TILES,
} from '@/data/landing-curation';
import { upsertLandingSectionAction } from './actions';

// ─── 타입 ────────────────────────────────────────────────────────────────────

type Props = {
  sectionMap: Record<string, LandingSection>;
};

type TabKey = 'hero' | 'masterpiece' | 'landscape' | 'lifestyle' | 'member_benefit';

// ─── 권장 이미지 사이즈 ───────────────────────────────────────────────────────

const IMAGE_HINT: Record<TabKey, string> = {
  hero: '1920 × 1080 px · 16:9 · JPG/PNG/WEBP · 최대 20MB',
  masterpiece: '800 × 1000 px · 4:5 · JPG/PNG/WEBP · 최대 20MB',
  landscape: '1200 × 800 px · 3:2 · JPG/PNG/WEBP · 최대 20MB',
  lifestyle: '900 × 1200 px · 3:4 · JPG/PNG/WEBP · 최대 20MB',
  member_benefit: '1200 × 800 px · 3:2 · JPG/PNG/WEBP · 최대 20MB',
};

// ─── 인라인 알림 ──────────────────────────────────────────────────────────────

function InlineAlert({
  message,
  type,
}: {
  message: string;
  type: 'success' | 'error';
}) {
  return (
    <div
      className={`mt-2 px-3 py-2 rounded text-sm ${
        type === 'success'
          ? 'bg-green-50 text-green-800 border border-green-200'
          : 'bg-red-50 text-red-800 border border-red-200'
      }`}
    >
      {message}
    </div>
  );
}

// ─── 이미지 업로드 영역 ───────────────────────────────────────────────────────

function ImageUploadArea({
  currentUrl,
  hint,
  fileInputId,
}: {
  currentUrl: string | null;
  hint: string;
  fileInputId: string;
}) {
  const [preview, setPreview] = useState<string | null>(null);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const url = URL.createObjectURL(f);
    setPreview(url);
  }

  const displayUrl = preview ?? currentUrl;

  return (
    <div className="space-y-2">
      {displayUrl ? (
        <div className="relative w-full aspect-video bg-soft-cloud overflow-hidden rounded border border-hairline">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={displayUrl}
            alt="섹션 이미지 미리보기"
            className="w-full h-full object-cover"
          />
        </div>
      ) : (
        <div className="flex items-center justify-center w-full aspect-video bg-soft-cloud rounded border border-dashed border-hairline text-sm text-muted-fg">
          이미지 없음 (정적 기본값 사용)
        </div>
      )}
      <div className="flex items-center gap-2 flex-wrap">
        <label
          htmlFor={fileInputId}
          className="cursor-pointer inline-flex items-center gap-1 h-8 px-3 text-xs font-medium border border-hairline rounded bg-canvas hover:bg-soft-cloud transition-colors"
        >
          이미지 파일 선택
        </label>
        <input
          id={fileInputId}
          name="file"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="sr-only"
          onChange={handleFileChange}
        />
        <span className="text-[11px] text-muted-fg">{hint}</span>
      </div>
    </div>
  );
}

// ─── 섹션 카드 (공통 래퍼) ───────────────────────────────────────────────────

function SectionCard({
  label,
  sectionKey,
  sectionType,
  sortOrder,
  section,
  imageHint,
  children,
}: {
  label: string;
  sectionKey: string;
  sectionType: TabKey;
  sortOrder: number;
  section: LandingSection | undefined;
  imageHint: string;
  children: React.ReactNode;
}) {
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(
    null,
  );
  const formRef = useRef<HTMLFormElement>(null);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setFeedback(null);
    startTransition(async () => {
      const result = await upsertLandingSectionAction(fd);
      if (result.ok) {
        setFeedback({ type: 'success', message: '저장되었습니다.' });
      } else {
        setFeedback({ type: 'error', message: result.error ?? '저장 실패' });
      }
    });
  }

  return (
    <div className="border border-hairline rounded-lg p-4 space-y-4 bg-canvas">
      <h3 className="text-sm font-semibold text-ink">{label}</h3>
      <form ref={formRef} onSubmit={handleSubmit}>
        {/* 숨김 필드 */}
        <input type="hidden" name="sectionKey" value={sectionKey} />
        <input type="hidden" name="sectionType" value={sectionType} />
        <input type="hidden" name="sortOrder" value={String(sortOrder)} />
        {section?.imageUrl && (
          <input type="hidden" name="existingImageUrl" value={section.imageUrl} />
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* 이미지 영역 */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-fg uppercase tracking-wide">이미지</p>
            <ImageUploadArea
              currentUrl={section?.imageUrl ?? null}
              hint={imageHint}
              fileInputId={`file-${sectionKey}`}
            />
          </div>

          {/* 텍스트 필드 영역 */}
          <div className="space-y-3">
            <p className="text-xs font-medium text-muted-fg uppercase tracking-wide">텍스트</p>
            {children}
          </div>
        </div>

        <div className="mt-4 flex items-center gap-3">
          <button
            type="submit"
            disabled={isPending}
            className="h-9 px-5 text-sm font-medium bg-ink text-canvas rounded hover:bg-charcoal disabled:opacity-50 transition-colors"
          >
            {isPending ? '저장 중...' : '저장'}
          </button>
          {feedback && (
            <InlineAlert message={feedback.message} type={feedback.type} />
          )}
        </div>
      </form>
    </div>
  );
}

// ─── 공통 텍스트 입력 헬퍼 ───────────────────────────────────────────────────

function Field({
  label,
  name,
  value,
  placeholder,
  type = 'text',
}: {
  label: string;
  name: string;
  value?: string;
  placeholder?: string;
  type?: 'text' | 'url' | 'color';
}) {
  return (
    <div className="space-y-1">
      <label className="text-xs text-muted-fg">{label}</label>
      <input
        type={type}
        name={`payload_${name}`}
        defaultValue={value ?? ''}
        placeholder={placeholder}
        className="w-full h-8 px-2 text-sm border border-hairline rounded bg-white focus:outline-none focus:ring-1 focus:ring-ink"
      />
    </div>
  );
}

function TextareaField({
  label,
  name,
  value,
  placeholder,
  rows = 3,
}: {
  label: string;
  name: string;
  value?: string;
  placeholder?: string;
  rows?: number;
}) {
  return (
    <div className="space-y-1">
      <label className="text-xs text-muted-fg">{label}</label>
      <textarea
        name={`payload_${name}`}
        defaultValue={value ?? ''}
        placeholder={placeholder}
        rows={rows}
        className="w-full px-2 py-1 text-sm border border-hairline rounded bg-white focus:outline-none focus:ring-1 focus:ring-ink resize-y"
      />
    </div>
  );
}

function SelectField({
  label,
  name,
  value,
  options,
}: {
  label: string;
  name: string;
  value?: string;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <div className="space-y-1">
      <label className="text-xs text-muted-fg">{label}</label>
      <select
        name={`payload_${name}`}
        defaultValue={value ?? options[0]?.value ?? ''}
        className="w-full h-8 px-2 text-sm border border-hairline rounded bg-white focus:outline-none focus:ring-1 focus:ring-ink"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

// ─── Hero 슬라이드 섹션 ──────────────────────────────────────────────────────

function HeroSections({ sectionMap }: { sectionMap: Record<string, LandingSection> }) {
  return (
    <div className="space-y-4">
      {HERO_SLIDES.map((def, i) => {
        const key = `hero_${i + 1}`;
        const section = sectionMap[key];
        const p = section?.payload ?? {};

        return (
          <SectionCard
            key={key}
            label={`히어로 슬라이드 ${i + 1}`}
            sectionKey={key}
            sectionType="hero"
            sortOrder={i + 1}
            section={section}
            imageHint={IMAGE_HINT.hero}
          >
            <Field
              label="아이브로우 (eyebrow)"
              name="eyebrow"
              value={(p['eyebrow'] as string) ?? def.eyebrow}
              placeholder={def.eyebrow}
            />
            <Field
              label="헤드라인 첫째 줄"
              name="headlineTop"
              value={(p['headlineTop'] as string) ?? def.headlineTop}
              placeholder={def.headlineTop}
            />
            <Field
              label="헤드라인 둘째 줄"
              name="headlineBottom"
              value={(p['headlineBottom'] as string) ?? def.headlineBottom}
              placeholder={def.headlineBottom}
            />
            <TextareaField
              label="설명 (subhead)"
              name="subhead"
              value={(p['subhead'] as string) ?? def.subhead}
              placeholder={def.subhead}
              rows={2}
            />
            <Field
              label="CTA 버튼 텍스트"
              name="ctaLabel"
              value={(p['ctaLabel'] as string) ?? def.cta.label}
              placeholder={def.cta.label}
            />
            <Field
              label="CTA 링크"
              name="ctaHref"
              value={(p['ctaHref'] as string) ?? def.cta.href}
              placeholder={def.cta.href}
              type="url"
            />
            <Field
              label="이미지 alt 텍스트"
              name="imageAlt"
              value={(p['imageAlt'] as string) ?? def.imageAlt}
              placeholder={def.imageAlt}
            />
            <SelectField
              label="텍스트 톤"
              name="tone"
              value={(p['tone'] as string) ?? def.tone}
              options={[
                { value: 'light', label: 'Light (밝은 배경)' },
                { value: 'dark', label: 'Dark (어두운 배경)' },
              ]}
            />
          </SectionCard>
        );
      })}
    </div>
  );
}

// ─── 명화 갤러리 섹션 ─────────────────────────────────────────────────────────

function MasterpieceSections({ sectionMap }: { sectionMap: Record<string, LandingSection> }) {
  return (
    <div className="space-y-4">
      {MASTERPIECE_TILES.map((def, i) => {
        const key = `masterpiece_${i + 1}`;
        const section = sectionMap[key];
        const p = section?.payload ?? {};

        return (
          <SectionCard
            key={key}
            label={`명화 ${i + 1} — ${def.title}`}
            sectionKey={key}
            sectionType="masterpiece"
            sortOrder={i + 1}
            section={section}
            imageHint={IMAGE_HINT.masterpiece}
          >
            <Field
              label="제목"
              name="title"
              value={(p['title'] as string) ?? def.title}
              placeholder={def.title}
            />
            <Field
              label="작가"
              name="artist"
              value={(p['artist'] as string) ?? def.artist}
              placeholder={def.artist}
            />
            <Field
              label="사이즈"
              name="size"
              value={(p['size'] as string) ?? def.size}
              placeholder={def.size}
            />
            <Field
              label="프레임 레이블"
              name="frameLabel"
              value={(p['frameLabel'] as string) ?? def.frameLabel}
              placeholder={def.frameLabel}
            />
            <Field
              label="스와치 색상"
              name="swatch"
              value={(p['swatch'] as string) ?? (def.swatch ?? '#ffffff')}
              type="color"
            />
            <Field
              label="링크 (href)"
              name="href"
              value={(p['href'] as string) ?? def.href}
              placeholder={def.href}
              type="url"
            />
            <Field
              label="이미지 alt 텍스트"
              name="imageAlt"
              value={(p['imageAlt'] as string) ?? def.imageAlt}
              placeholder={def.imageAlt}
            />
          </SectionCard>
        );
      })}
    </div>
  );
}

// ─── 풍경 컬렉션 섹션 ────────────────────────────────────────────────────────

function LandscapeSections({ sectionMap }: { sectionMap: Record<string, LandingSection> }) {
  return (
    <div className="space-y-4">
      {LANDSCAPE_TILES.map((def, i) => {
        const key = `landscape_${i + 1}`;
        const section = sectionMap[key];
        const p = section?.payload ?? {};

        return (
          <SectionCard
            key={key}
            label={`풍경 ${i + 1} — ${def.title}`}
            sectionKey={key}
            sectionType="landscape"
            sortOrder={i + 1}
            section={section}
            imageHint={IMAGE_HINT.landscape}
          >
            <Field
              label="제목"
              name="title"
              value={(p['title'] as string) ?? def.title}
              placeholder={def.title}
            />
            <Field
              label="캡션"
              name="caption"
              value={(p['caption'] as string) ?? def.caption}
              placeholder={def.caption}
            />
            <Field
              label="링크 (href)"
              name="href"
              value={(p['href'] as string) ?? def.href}
              placeholder={def.href}
              type="url"
            />
            <Field
              label="이미지 alt 텍스트"
              name="imageAlt"
              value={(p['imageAlt'] as string) ?? def.imageAlt}
              placeholder={def.imageAlt}
            />
          </SectionCard>
        );
      })}
    </div>
  );
}

// ─── 라이프스타일 섹션 ────────────────────────────────────────────────────────

function LifestyleSections({ sectionMap }: { sectionMap: Record<string, LandingSection> }) {
  return (
    <div className="space-y-4">
      {LIFESTYLE_BLOCKS.map((def, i) => {
        const key = `lifestyle_${i + 1}`;
        const section = sectionMap[key];
        const p = section?.payload ?? {};

        const defaultBullets = def.bullets.join('\n');

        return (
          <SectionCard
            key={key}
            label={`라이프스타일 ${i + 1}`}
            sectionKey={key}
            sectionType="lifestyle"
            sortOrder={i + 1}
            section={section}
            imageHint={IMAGE_HINT.lifestyle}
          >
            <Field
              label="아이브로우"
              name="eyebrow"
              value={(p['eyebrow'] as string) ?? def.eyebrow}
              placeholder={def.eyebrow}
            />
            <TextareaField
              label="헤드라인 (줄바꿈: Enter)"
              name="headline"
              value={(p['headline'] as string) ?? def.headline}
              placeholder={def.headline}
              rows={2}
            />
            <TextareaField
              label="본문"
              name="body"
              value={(p['body'] as string) ?? def.body}
              placeholder={def.body}
              rows={3}
            />
            <TextareaField
              label="불릿 포인트 (줄마다 한 항목)"
              name="bullets"
              value={(p['bullets'] as string) ?? defaultBullets}
              placeholder={defaultBullets}
              rows={3}
            />
            <Field
              label="CTA 버튼 텍스트"
              name="ctaLabel"
              value={(p['ctaLabel'] as string) ?? def.cta.label}
              placeholder={def.cta.label}
            />
            <Field
              label="CTA 링크"
              name="ctaHref"
              value={(p['ctaHref'] as string) ?? def.cta.href}
              placeholder={def.cta.href}
              type="url"
            />
            <Field
              label="이미지 alt 텍스트"
              name="imageAlt"
              value={(p['imageAlt'] as string) ?? def.imageAlt}
              placeholder={def.imageAlt}
            />
          </SectionCard>
        );
      })}
    </div>
  );
}

// ─── 멤버 혜택 섹션 ───────────────────────────────────────────────────────────

function MemberBenefitSections({ sectionMap }: { sectionMap: Record<string, LandingSection> }) {
  // MEMBER_BENEFIT_TILES is readonly tuple — convert to regular array
  const tiles = [...MEMBER_BENEFIT_TILES];

  return (
    <div className="space-y-4">
      {tiles.map((def, i) => {
        const key = `member_benefit_${i + 1}`;
        const section = sectionMap[key];
        const p = section?.payload ?? {};

        return (
          <SectionCard
            key={key}
            label={`멤버 혜택 ${i + 1} — ${def.headline}`}
            sectionKey={key}
            sectionType="member_benefit"
            sortOrder={i + 1}
            section={section}
            imageHint={IMAGE_HINT.member_benefit}
          >
            <Field
              label="아이브로우"
              name="eyebrow"
              value={(p['eyebrow'] as string) ?? def.eyebrow}
              placeholder={def.eyebrow}
            />
            <Field
              label="헤드라인"
              name="headline"
              value={(p['headline'] as string) ?? def.headline}
              placeholder={def.headline}
            />
            <Field
              label="CTA 버튼 텍스트"
              name="ctaLabel"
              value={(p['ctaLabel'] as string) ?? def.cta.label}
              placeholder={def.cta.label}
            />
            <Field
              label="CTA 링크"
              name="ctaHref"
              value={(p['ctaHref'] as string) ?? def.cta.href}
              placeholder={def.cta.href}
              type="url"
            />
            <Field
              label="이미지 alt 텍스트"
              name="imageAlt"
              value={(p['imageAlt'] as string) ?? def.imageAlt}
              placeholder={def.imageAlt}
            />
          </SectionCard>
        );
      })}
    </div>
  );
}

// ─── 탭 바 ───────────────────────────────────────────────────────────────────

const TABS: Array<{ key: TabKey; label: string; count: number }> = [
  { key: 'hero', label: '히어로 슬라이드', count: 3 },
  { key: 'masterpiece', label: '명화 갤러리', count: 6 },
  { key: 'landscape', label: '풍경 컬렉션', count: 5 },
  { key: 'lifestyle', label: '라이프스타일', count: 1 },
  { key: 'member_benefit', label: '멤버 혜택', count: 3 },
];

// ─── 메인 에디터 ──────────────────────────────────────────────────────────────

export function LandingEditor({ sectionMap }: Props) {
  const [activeTab, setActiveTab] = useState<TabKey>('hero');

  return (
    <div className="space-y-4">
      {/* 탭 바 */}
      <div className="flex gap-1 flex-wrap border-b border-hairline pb-1">
        {TABS.map((tab) => {
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`h-8 px-4 text-sm font-medium rounded-t transition-colors ${
                isActive
                  ? 'bg-ink text-canvas'
                  : 'text-muted-fg hover:text-ink hover:bg-soft-cloud'
              }`}
            >
              {tab.label}
              <span className="ml-1 text-xs opacity-60">({tab.count})</span>
            </button>
          );
        })}
      </div>

      {/* 탭 콘텐츠 */}
      <div>
        {activeTab === 'hero' && <HeroSections sectionMap={sectionMap} />}
        {activeTab === 'masterpiece' && <MasterpieceSections sectionMap={sectionMap} />}
        {activeTab === 'landscape' && <LandscapeSections sectionMap={sectionMap} />}
        {activeTab === 'lifestyle' && <LifestyleSections sectionMap={sectionMap} />}
        {activeTab === 'member_benefit' && <MemberBenefitSections sectionMap={sectionMap} />}
      </div>
    </div>
  );
}
