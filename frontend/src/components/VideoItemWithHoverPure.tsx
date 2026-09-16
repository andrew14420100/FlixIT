// @ts-nocheck
import { PureComponent, ForwardedRef, forwardRef } from "react";

type VideoItemWithHoverPureType = {
  src: string;
  innerRef: ForwardedRef<HTMLDivElement>;
  handleHover: (value: boolean) => void;
};

class VideoItemWithHoverPure extends PureComponent<VideoItemWithHoverPureType> {
  private containerRef: HTMLDivElement | null = null;
  private imageRef: HTMLImageElement | null = null;
  private isHovered: boolean = false;

  componentWillUnmount() {
    if (this.containerRef) {
      this.containerRef.style.transform = "scale(1)";
      this.containerRef.style.zIndex = "1";
    }
  }

  handleMouseEnter = () => {
    this.isHovered = true;
    this.props.handleHover(true);
    
    if (this.containerRef) {
      this.containerRef.style.zIndex = "50";
      this.containerRef.style.transition = "transform 0.35s cubic-bezier(0.25, 0.1, 0.25, 1)";
      requestAnimationFrame(() => {
        if (this.containerRef && this.isHovered) {
          this.containerRef.style.transform = "scale(1.3)";
        }
      });
    }
    if (this.imageRef) {
      this.imageRef.style.boxShadow = "0 16px 48px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.08)";
      this.imageRef.style.borderRadius = "6px";
    }
  };

  handleMouseLeave = (e: React.MouseEvent<HTMLDivElement>) => {
    const relatedTarget = e.relatedTarget as HTMLElement;
    if (relatedTarget) {
      const isMovingToPortal = relatedTarget.closest('[data-portal-card]') !== null;
      if (isMovingToPortal) return;
    }
    
    this.isHovered = false;
    this.props.handleHover(false);
    
    if (this.containerRef) {
      this.containerRef.style.transition = "transform 0.35s cubic-bezier(0.25, 0.1, 0.25, 1)";
      this.containerRef.style.transform = "scale(1)";
      setTimeout(() => {
        if (this.containerRef && !this.isHovered) {
          this.containerRef.style.zIndex = "1";
        }
      }, 350);
    }
    if (this.imageRef) {
      this.imageRef.style.boxShadow = "0 2px 8px rgba(0,0,0,0.3)";
      this.imageRef.style.borderRadius = "4px";
    }
  };

  setContainerRef = (ref: HTMLDivElement | null) => {
    this.containerRef = ref;
    if (typeof this.props.innerRef === 'function') {
      this.props.innerRef(ref);
    } else if (this.props.innerRef) {
      (this.props.innerRef as any).current = ref;
    }
  };

  render() {
    return (
      <div
        ref={this.setContainerRef}
        onMouseEnter={this.handleMouseEnter}
        onMouseLeave={this.handleMouseLeave}
        style={{
          cursor: "pointer",
          borderRadius: "4px",
          width: "100%",
          position: "relative",
          paddingTop: "calc(9 / 16 * 100%)",
          transform: "scale(1)",
          transformOrigin: "center center",
          transition: "transform 0.35s cubic-bezier(0.25, 0.1, 0.25, 1)",
          zIndex: 1,
          willChange: "transform",
          pointerEvents: "auto",
        }}
      >
        <img
          ref={(ref) => { this.imageRef = ref; }}
          src={this.props.src}
          alt="Movie poster"
          style={{
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
            position: "absolute",
            borderRadius: "4px",
            transition: "box-shadow 0.35s cubic-bezier(0.25, 0.1, 0.25, 1), border-radius 0.35s ease",
            boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
            backfaceVisibility: "hidden",
            transform: "translateZ(0)",
            pointerEvents: "none",
          }}
        />
      </div>
    );
  }
}

const VideoItemWithHoverRef = forwardRef<
  HTMLDivElement,
  Omit<VideoItemWithHoverPureType, "innerRef">
>((props, ref) => <VideoItemWithHoverPure {...props} innerRef={ref} />);
VideoItemWithHoverRef.displayName = "VideoItemWithHoverRef";

export default VideoItemWithHoverRef;
