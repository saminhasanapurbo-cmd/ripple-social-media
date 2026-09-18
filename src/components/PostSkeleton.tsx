import React from 'react';

interface PostSkeletonProps {
  count?: number;
}

export const PostSkeleton: React.FC<{ hasBreadcrumb?: boolean; className?: string }> = ({ 
  hasBreadcrumb = false,
  className = ''
}) => {
  return (
    <article 
      className={`bg-white rounded-2xl border border-slate-100/90 shadow-sm p-4 animate-pulse ${className}`}
      aria-hidden="true"
    >
      {hasBreadcrumb && (
        <div className="mb-2.5 flex items-center gap-1.5 h-6 w-44 bg-teal-50/80 rounded-lg" />
      )}
      
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <div className="w-10 h-10 rounded-full bg-slate-200 shrink-0" />
          <div>
            <div className="h-3.5 w-28 bg-slate-200 rounded-md mb-1.5" />
            <div className="h-2.5 w-20 bg-slate-100 rounded-md" />
          </div>
        </div>
        <div className="w-5 h-5 rounded-full bg-slate-100" />
      </div>

      {/* Content lines */}
      <div className="space-y-2 mt-3.5">
        <div className="h-3 w-full bg-slate-100 rounded-md" />
        <div className="h-3 w-5/6 bg-slate-100 rounded-md" />
        <div className="h-3 w-3/5 bg-slate-100 rounded-md" />
      </div>

      {/* Action Bar */}
      <div className="flex items-center gap-4 mt-4 pt-3 border-t border-slate-50">
        <div className="h-6 w-14 bg-slate-100 rounded-lg" />
        <div className="h-6 w-14 bg-slate-100 rounded-lg" />
        <div className="h-6 w-16 bg-slate-100 rounded-lg" />
      </div>
    </article>
  );
};

export const FeedSkeletonList: React.FC<PostSkeletonProps> = ({ count = 3 }) => {
  return (
    <div className="space-y-3" aria-label="Loading posts" role="status">
      {Array.from({ length: count }).map((_, index) => (
        <PostSkeleton key={index} hasBreadcrumb={index === 1} />
      ))}
      <span className="sr-only">Loading latest posts...</span>
    </div>
  );
};
