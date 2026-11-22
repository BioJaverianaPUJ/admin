import { useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  EyeOff,
  Heart,
  Link2,
  Lock,
  MessageCircle,
  ThumbsDown,
} from "lucide-react";

export interface Author {
  id: string;
  username: string;
  profilePictureUrl?: string | null;
}
export interface PostContent {
  id: string;
  author?: Author;
  title?: string;
  description?: string;
  observation?: string | null;
  images?: { url: string }[];
  firstImageUrl?: string | null;
  totalLikes?: number;
  totalDislikes?: number;
  hidden?: boolean;
  banned?: boolean;
  createdAt: string;
}
export interface CommentContent {
  id: string;
  author?: Author;
  postId?: string;
  parentId?: string | null;
  content?: string;
  totalReactions?: number;
  reactions?: { emoji: string; count: number }[];
  hidden?: boolean;
  banned?: boolean;
  createdAt: string;
}

export const reactionEmoji: Record<string, string> = {
  LIKE: "👍",
  LOVE: "❤️",
  HAHA: "😂",
  WOW: "😮",
  SAD: "😢",
  ANGRY: "😠",
};

export function formatDate(value?: string) {
  if (!value) return "Fecha no disponible";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Fecha no disponible"
    : date.toLocaleString("es-CO", {
        dateStyle: "medium",
        timeStyle: "short",
      });
}

export function Avatar({
  author,
  size = 38,
}: {
  author?: Author;
  size?: number;
}) {
  const [failed, setFailed] = useState(false);
  const initial = (author?.username ?? "?").charAt(0).toUpperCase();
  return (
    <span
      className="cp-avatar"
      style={{ width: size, height: size, fontSize: size * 0.42 }}
      aria-hidden="true"
    >
      {author?.profilePictureUrl && !failed ? (
        <img
          src={author.profilePictureUrl}
          alt=""
          onError={() => setFailed(true)}
        />
      ) : (
        initial
      )}
    </span>
  );
}

/** Estados de moderación visibles en el contenido (RF-61). */
export function ModerationFlags({
  hidden,
  banned,
}: {
  hidden?: boolean;
  banned?: boolean;
}) {
  if (!hidden && !banned) return null;
  return (
    <div className="cp-flags">
      {hidden && (
        <span className="cp-flag">
          <EyeOff size={13} /> Oculto: solo lo ve el administrador
        </span>
      )}
      {banned && (
        <span className="cp-flag danger">
          <Lock size={13} /> Bloqueado: solo lo ven su autor y el administrador
        </span>
      )}
    </div>
  );
}

/** Publicación tal como la ve la comunidad en la aplicación móvil. */
export function PostPreview({
  post,
  highlight = false,
  commentCount,
}: {
  post: PostContent;
  highlight?: boolean;
  commentCount?: number;
}) {
  const images = post.images?.length
    ? post.images.map((i) => i.url)
    : post.firstImageUrl
      ? [post.firstImageUrl]
      : [];
  const [index, setIndex] = useState(0);
  const current = Math.min(index, Math.max(images.length - 1, 0));
  return (
    <article className={`cp-card ${highlight ? "highlight" : ""}`}>
      <header className="cp-header">
        <Avatar author={post.author} />
        <div>
          <strong>@{post.author?.username ?? "usuario"}</strong>
          <small>{formatDate(post.createdAt)}</small>
        </div>
        {highlight && <span className="cp-tag">Contenido denunciado</span>}
      </header>
      <ModerationFlags hidden={post.hidden} banned={post.banned} />
      {images.length > 0 && (
        <div className="cp-gallery">
          <img
            src={images[current]}
            alt={`Imagen ${current + 1} de ${images.length} de la publicación`}
          />
          {images.length > 1 && (
            <>
              <button
                className="cp-nav prev"
                aria-label="Imagen anterior"
                disabled={current === 0}
                onClick={() => setIndex(current - 1)}
              >
                <ChevronLeft size={18} />
              </button>
              <button
                className="cp-nav next"
                aria-label="Imagen siguiente"
                disabled={current === images.length - 1}
                onClick={() => setIndex(current + 1)}
              >
                <ChevronRight size={18} />
              </button>
              <span className="cp-counter">
                {current + 1}/{images.length}
              </span>
            </>
          )}
        </div>
      )}
      <div className="cp-body">
        <div className="cp-stats">
          <span>
            <Heart size={15} /> {post.totalLikes ?? 0}
          </span>
          <span>
            <ThumbsDown size={15} /> {post.totalDislikes ?? 0}
          </span>
          {commentCount !== undefined && (
            <span>
              <MessageCircle size={15} /> {commentCount}
            </span>
          )}
          {post.observation && (
            <span className="cp-obs">
              <Link2 size={14} /> Observación asociada
            </span>
          )}
        </div>
        <h3>{post.title || "Publicación sin título"}</h3>
        {post.description && <p>{post.description}</p>}
      </div>
    </article>
  );
}

/** Comentario o respuesta, con sus reacciones. */
export function CommentPreview({
  comment,
  highlight = false,
  reply = false,
}: {
  comment: CommentContent;
  highlight?: boolean;
  reply?: boolean;
}) {
  return (
    <article
      className={`cp-comment ${highlight ? "highlight" : ""} ${reply ? "reply" : ""}`}
    >
      <Avatar author={comment.author} size={reply ? 28 : 32} />
      <div>
        <p className="cp-comment-head">
          <strong>@{comment.author?.username ?? "usuario"}</strong>
          <small>{formatDate(comment.createdAt)}</small>
          {highlight && <span className="cp-tag">Comentario denunciado</span>}
        </p>
        <ModerationFlags hidden={comment.hidden} banned={comment.banned} />
        <p className="cp-comment-text">{comment.content}</p>
        {comment.reactions?.length || comment.totalReactions ? (
          <p className="cp-reactions">
            {comment.reactions?.length
              ? comment.reactions.map((r) => (
                  <span key={r.emoji}>
                    {reactionEmoji[r.emoji] ?? r.emoji} {r.count}
                  </span>
                ))
              : `${comment.totalReactions} reacciones`}
          </p>
        ) : null}
      </div>
    </article>
  );
}
