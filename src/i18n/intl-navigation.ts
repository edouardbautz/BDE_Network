import { createNavigation } from 'next-intl/navigation';
import { routing } from './routing';

/** next-intl's own navigation helpers. Code imports them from `./navigation`, which swaps in our `Link`. */
export const {
  Link: IntlLink,
  redirect,
  usePathname,
  useRouter,
  getPathname,
} = createNavigation(routing);
