/** Someone's face, or their initials.
 *
 * The photo is Clerk's — `db/SCHEMA.md` keeps avatars out of this database on
 * purpose, because a copy of something Clerk owns is a copy that drifts. The
 * API resolves `image_url` per request; null means there is nothing to show,
 * which is the normal case for an invited person who has no Clerk account yet.
 *
 * Initials are not a placeholder for a photo that failed — they are the other
 * correct answer. That matters for how this behaves when an image will not
 * load: it falls back silently rather than leaving a broken-image glyph or an
 * empty circle in a list of forty people.
 */
import { useState } from "react";

import { displayInitials } from "../display";
import type { User } from "../types";

export function Avatar({
  user,
  size,
}: {
  user: User;
  /** "lg" is the profile header. Default is the roster row. */
  size?: "lg";
}) {
  // Reset is by remount, not by effect: every caller already keys these on the
  // person (the roster by row, the detail panel by user id), so a different
  // person is a different component and this starts false again on its own.
  const [broken, setBroken] = useState(false);
  const src = user.image_url;

  return (
    <span className="console-avatar" data-size={size} aria-hidden="true">
      {src && !broken ? (
        <img
          className="console-avatar-img"
          src={src}
          // Decorative: every one of these sits beside the person's name in
          // the same row. An alt here would have a screen reader read every
          // name on the roster twice.
          alt=""
          loading="lazy"
          onError={() => setBroken(true)}
        />
      ) : (
        displayInitials(user)
      )}
    </span>
  );
}
