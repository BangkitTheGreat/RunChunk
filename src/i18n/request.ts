import {cookies} from 'next/headers';
import {getRequestConfig} from 'next-intl/server';
import id from '../../messages/id.json';
import en from '../../messages/en.json';

const MESSAGES = {id, en} as const;

export default getRequestConfig(async () => {
  const locale = (await cookies()).get('locale')?.value === 'en' ? 'en' : 'id';
  return {locale, messages: MESSAGES[locale]};
});
