import { cn } from "@/lib/utils";

import styles from "./container.module.css";

type ContainerProps<Element extends React.ElementType = "div"> = {
  as?: Element;
} & React.ComponentPropsWithoutRef<Element>;

export function Container<Element extends React.ElementType = "div">({
  as,
  className,
  ...props
}: ContainerProps<Element>) {
  const Component = as ?? "div";
  return <Component className={cn(styles.container, className)} {...props} />;
}
