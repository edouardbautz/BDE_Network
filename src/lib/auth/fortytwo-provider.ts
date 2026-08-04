import type { OAuthConfig } from 'next-auth/providers';

interface FortyTwoCampus {
  id: number;
  name: string;
}

interface FortyTwoCampusUser {
  campus_id: number;
  is_primary: boolean;
}

/** Shape of the relevant fields from GET https://api.intra.42.fr/v2/me */
export interface FortyTwoProfile {
  id: number;
  login: string;
  email: string;
  first_name: string;
  last_name: string;
  usual_full_name: string | null;
  image: { link: string | null } | null;
  campus: FortyTwoCampus[];
  campus_users: FortyTwoCampusUser[];
}

/** The 42 API lists every campus a user has ever been part of; the primary
 * one (their "home" campus) is flagged in campus_users, not campus itself. */
function resolvePrimaryCampus(profile: FortyTwoProfile): string | undefined {
  const primary = profile.campus_users.find((campusUser) => campusUser.is_primary);
  const campusId = primary?.campus_id ?? profile.campus[0]?.id;
  return profile.campus.find((campus) => campus.id === campusId)?.name;
}

export function FortyTwoProvider(): OAuthConfig<FortyTwoProfile> {
  return {
    id: '42-school',
    name: '42',
    type: 'oauth',
    authorization: 'https://api.intra.42.fr/oauth/authorize?scope=public',
    token: 'https://api.intra.42.fr/oauth/token',
    userinfo: 'https://api.intra.42.fr/v2/me',
    clientId: process.env.FORTYTWO_CLIENT_ID,
    clientSecret: process.env.FORTYTWO_CLIENT_SECRET,
    profile(profile) {
      const campus = resolvePrimaryCampus(profile);
      return {
        id: String(profile.id),
        login: profile.login,
        name: profile.usual_full_name || `${profile.first_name} ${profile.last_name}`,
        email: profile.email,
        image: profile.image?.link ?? null,
        campus: campus ?? '',
      };
    },
  };
}
