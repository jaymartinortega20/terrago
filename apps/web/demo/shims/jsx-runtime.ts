// Automatic JSX runtime on top of the React UMD global (React 18 UMD has no jsx-runtime build).
import React from 'react';

type Props = Record<string, unknown> & { children?: unknown };

export const Fragment = React.Fragment;

export function jsx(type: React.ElementType, props: Props, key?: React.Key) {
  const { children, ...rest } = props ?? {};
  if (key !== undefined) (rest as Record<string, unknown>).key = key;
  if (children === undefined) return React.createElement(type, rest);
  return Array.isArray(children) ? React.createElement(type, rest, ...children) : React.createElement(type, rest, children as React.ReactNode);
}

export const jsxs = jsx;
