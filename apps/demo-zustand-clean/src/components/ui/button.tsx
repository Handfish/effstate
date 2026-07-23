import * as React from "react";
import { cn } from "@/lib/utils";

const variantStyles = {
  default: "bg-blue-600 text-white hover:bg-blue-500",
  destructive: "bg-red-600 text-white hover:bg-red-500",
  outline: "border border-gray-500 bg-transparent hover:bg-gray-700 text-gray-200",
  secondary: "bg-gray-600 text-white hover:bg-gray-500",
};

const sizeStyles = {
  default: "h-10 px-4 py-2",
  sm: "h-9 px-3 text-sm",
  lg: "h-11 px-8",
};

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof variantStyles;
  size?: keyof typeof sizeStyles;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "default", ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          "inline-flex items-center justify-center rounded-md font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none",
          variantStyles[variant],
          sizeStyles[size],
          className
        )}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";
