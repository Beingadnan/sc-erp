/**
 * Draft pages a school can start from. Written in the restricted Markdown the site
 * renders: # headings, paragraphs, - lists, **bold**, [links](https://…).
 * Every page is created as an unpublished draft for the school to edit.
 */
export const STARTER_PAGES: Array<{
  slug: string;
  title: string;
  body: (school: string) => string;
}> = [
  {
    slug: 'home',
    title: 'Welcome',
    body: (school) =>
      `# Welcome to ${school}

Write two or three sentences about your school: what makes it special, the boards you follow and the classes you offer.

## Why parents choose us

- Experienced and caring teachers
- Safe campus and transport
- Strong results and activities

[Ask about admission](inquiry)`,
  },
  {
    slug: 'about',
    title: 'About us',
    body: (school) =>
      `# About ${school}

Tell visitors when the school was founded, its vision and its leadership.

## Our vision

Replace this with your school's vision and mission.`,
  },
  {
    slug: 'admissions',
    title: 'Admissions',
    body: () =>
      `# Admissions

Describe the classes open for admission, the age criteria and the documents parents should keep ready.

## Documents usually needed

- Birth certificate
- Previous school report card and transfer certificate
- Address proof
- Passport-size photographs

Fill in the [inquiry form](inquiry) and our office will call you.`,
  },
  {
    slug: 'contact',
    title: 'Contact',
    body: () =>
      `# Contact us

Add office hours here. The address and phone number of each campus are shown at the bottom of every page.`,
  },
];
