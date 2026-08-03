/// <reference types="vite/client" />
import type * as React from 'react'
import type { PrismApi } from '../../preload'

declare global {
  interface Window {
    prism: PrismApi
  }

  /** React 19 убрал глобальный namespace JSX — возвращаем его, чтобы не тащить React.JSX по всем файлам */
  namespace JSX {
    type Element = React.JSX.Element
    type ElementClass = React.JSX.ElementClass
    type ElementAttributesProperty = React.JSX.ElementAttributesProperty
    type ElementChildrenAttribute = React.JSX.ElementChildrenAttribute
    type IntrinsicAttributes = React.JSX.IntrinsicAttributes
    type IntrinsicClassAttributes<T> = React.JSX.IntrinsicClassAttributes<T>
    type IntrinsicElements = React.JSX.IntrinsicElements
  }
}

export {}
