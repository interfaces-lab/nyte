"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@nyte-ai/ui";

export function AvatarDemo() {
  return (
    <>
      <Avatar size="lg">
        <AvatarImage src="https://github.com/interfaces-lab.png" alt="interfaces-lab" />
        <AvatarFallback>IL</AvatarFallback>
      </Avatar>
      <Avatar size="md">
        <AvatarFallback>NY</AvatarFallback>
      </Avatar>
      <Avatar size="sm" shape="rounded">
        <AvatarFallback>SM</AvatarFallback>
      </Avatar>
      <Avatar size="xs" shape="rounded">
        <AvatarFallback>XS</AvatarFallback>
      </Avatar>
    </>
  );
}

export function AvatarTonesDemo() {
  return (
    <>
      <Avatar tone="neutral">
        <AvatarFallback>NE</AvatarFallback>
      </Avatar>
      <Avatar tone="orange">
        <AvatarFallback>OR</AvatarFallback>
      </Avatar>
      <Avatar tone="blue">
        <AvatarFallback>BL</AvatarFallback>
      </Avatar>
      <Avatar tone="violet">
        <AvatarFallback>VI</AvatarFallback>
      </Avatar>
      <Avatar tone="green">
        <AvatarFallback>GR</AvatarFallback>
      </Avatar>
    </>
  );
}
